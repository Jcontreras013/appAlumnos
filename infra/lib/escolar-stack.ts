import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Lo que no debe viajar al contexto de `docker build` (el Dockerfile instala y compila todo). */
const ASSET_EXCLUDE = [
  "**/node_modules",
  "**/.next",
  "**/dist",
  "**/.turbo",
  "**/.env",
  "infra/cdk.out",
  ".git",
];

export type Stage = "dev" | "prod";

export interface EscolarStackProps extends StackProps {
  stage: Stage;
  /**
   * ARN completo del secreto con las llaves JWT (JWT_KEY_ID, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY).
   * Se crea una sola vez antes del primer despliegue; ver README → Despliegue en AWS.
   */
  jwtSecretArn?: string;
  /** Certificado de ACM para HTTPS. Sin él el panel queda en HTTP: solo para probar, nunca con datos reales. */
  certificateArn?: string;
}

/**
 * Arquitectura:
 *
 *   Internet ─▶ ALB ─▶ web (Next.js) ──Service Connect──▶ identity ─┬─▶ RDS Postgres
 *                                                      └──────────▶ academic ─┘   (una base por servicio)
 *
 * - Solo el ALB recibe tráfico de internet. identity solo acepta conexiones de web; RDS solo de identity.
 * - RDS vive en subredes aisladas (sin salida a internet), cifrado y con backups automáticos.
 * - Sin NAT Gateway para ahorrar (~USD 32/mes): las tareas usan IP pública solo para salir hacia ECR,
 *   CloudWatch y Secrets Manager; los security groups bloquean toda entrada directa.
 */
export class EscolarStack extends Stack {
  constructor(scope: Construct, id: string, props: EscolarStackProps) {
    super(scope, id, props);
    const isProd = props.stage === "prod";

    if (!props.jwtSecretArn) {
      throw new Error(
        "Falta el contexto jwtSecretArn. Crea el secreto de llaves JWT (ver README) y pásalo con -c jwtSecretArn=arn:...",
      );
    }

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "publica", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "datos", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      // Service Connect: los servicios se encuentran por nombre (http://identity:3001) sin exponerse.
      defaultCloudMapNamespace: { name: "escolar.local", useForServiceConnect: true },
    });

    // ───────────────────────────── Base de datos ─────────────────────────────
    const database = new rds.DatabaseInstance(this, "Postgres", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      credentials: rds.Credentials.fromGeneratedSecret("escolar"),
      databaseName: "escolar_identity",
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      publiclyAccessible: false,
      multiAz: isProd,
      backupRetention: Duration.days(isProd ? 14 : 3),
      deletionProtection: isProd,
      removalPolicy: isProd ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
      cloudwatchLogsExports: ["postgresql"],
    });
    const dbSecret = database.secret;
    if (!dbSecret) throw new Error("RDS no generó el secreto de credenciales");

    const jwtSecret = secretsmanager.Secret.fromSecretCompleteArn(this, "JwtSecret", props.jwtSecretArn);

    // ───────────────────────────── Microservicios ─────────────────────────────
    /**
     * Un microservicio interno: Fargate, sin entrada desde internet, publicado por Service Connect
     * como http://<nombre>:<puerto>, con su propia base de datos dentro del mismo RDS
     * (el servicio la crea al arrancar si no existe) y rollback automático si no arranca sano.
     */
    const backendService = (
      name: string,
      options: { port: number; environment?: Record<string, string>; secrets?: Record<string, ecs.Secret> },
    ) => {
      const id = name.charAt(0).toUpperCase() + name.slice(1);
      const task = new ecs.FargateTaskDefinition(this, `${id}Task`, {
        cpu: 256,
        memoryLimitMiB: 512,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });
      task.addContainer(name, {
        image: ecs.ContainerImage.fromAsset(REPO_ROOT, {
          file: `services/${name}/Dockerfile`,
          exclude: ASSET_EXCLUDE,
        }),
        portMappings: [{ name, containerPort: options.port }],
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: name,
          logRetention: isProd ? logs.RetentionDays.SIX_MONTHS : logs.RetentionDays.ONE_MONTH,
        }),
        environment: {
          PORT: String(options.port),
          LOG_LEVEL: "info",
          RUN_MIGRATIONS: "true",
          DB_NAME: `escolar_${name}`,
          DB_SSLMODE: "require",
          ...options.environment,
        },
        secrets: {
          DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, "host"),
          DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, "port"),
          DB_USER: ecs.Secret.fromSecretsManager(dbSecret, "username"),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, "password"),
          ...options.secrets,
        },
        healthCheck: {
          command: [
            "CMD-SHELL",
            `node -e "fetch('http://localhost:${options.port}/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`,
          ],
          interval: Duration.seconds(30),
          startPeriod: Duration.seconds(60),
        },
      });
      const service = new ecs.FargateService(this, `${id}Service`, {
        cluster,
        taskDefinition: task,
        desiredCount: isProd ? 2 : 1,
        assignPublicIp: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        circuitBreaker: { enable: true, rollback: true },
        serviceConnectConfiguration: {
          services: [{ portMappingName: name, dnsName: name, port: options.port }],
        },
      });
      database.connections.allowDefaultPortFrom(service, `${name} -> Postgres`);
      return { task, service };
    };

    const identity = backendService("identity", {
      port: 3001,
      secrets: {
        JWT_KEY_ID: ecs.Secret.fromSecretsManager(jwtSecret, "JWT_KEY_ID"),
        JWT_PRIVATE_KEY: ecs.Secret.fromSecretsManager(jwtSecret, "JWT_PRIVATE_KEY"),
        JWT_PUBLIC_KEY: ecs.Secret.fromSecretsManager(jwtSecret, "JWT_PUBLIC_KEY"),
      },
    });
    const identityService = identity.service;

    // academic no tiene la llave privada: verifica tokens con el JWKS público de identity.
    const academic = backendService("academic", {
      port: 3002,
      environment: { IDENTITY_URL: "http://identity:3001" },
    });
    identityService.connections.allowFrom(academic.service, ec2.Port.tcp(3001), "academic -> identity");

    // ───────────────────────────── Frontend web ─────────────────────────────
    const certificate = props.certificateArn
      ? acm.Certificate.fromCertificateArn(this, "Certificado", props.certificateArn)
      : undefined;

    const web = new ecsPatterns.ApplicationLoadBalancedFargateService(this, "Web", {
      cluster,
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: isProd ? 2 : 1,
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      publicLoadBalancer: true,
      minHealthyPercent: 100,
      circuitBreaker: { rollback: true },
      ...(certificate
        ? {
            certificate,
            protocol: elbv2.ApplicationProtocol.HTTPS,
            redirectHTTP: true,
            sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
          }
        : {}),
      taskImageOptions: {
        containerName: "web",
        containerPort: 3000,
        image: ecs.ContainerImage.fromAsset(REPO_ROOT, {
          file: "apps/web/Dockerfile",
          exclude: ASSET_EXCLUDE,
        }),
        environment: {
          IDENTITY_URL: "http://identity:3001",
          ACADEMIC_URL: "http://academic:3002",
          COOKIE_SECURE: certificate ? "true" : "false",
        },
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: "web",
          logRetention: isProd ? logs.RetentionDays.SIX_MONTHS : logs.RetentionDays.ONE_MONTH,
        }),
      },
    });
    web.targetGroup.configureHealthCheck({ path: "/api/health", healthyHttpCodes: "200" });
    // web es cliente de Service Connect (resuelve "identity") pero no publica ningún endpoint interno.
    web.service.enableServiceConnect();
    identityService.connections.allowFrom(web.service, ec2.Port.tcp(3001), "web -> identity");
    academic.service.connections.allowFrom(web.service, ec2.Port.tcp(3002), "web -> academic");

    // ───────────────────────────── Salidas ─────────────────────────────
    new CfnOutput(this, "UrlPanel", {
      value: `${certificate ? "https" : "http"}://${web.loadBalancer.loadBalancerDnsName}`,
    });
    new CfnOutput(this, "NombreCluster", { value: cluster.clusterName });
    new CfnOutput(this, "IdentityTaskDefinition", { value: identity.task.family });
    new CfnOutput(this, "IdentitySecurityGroup", {
      value: identityService.connections.securityGroups.map((sg) => sg.securityGroupId).join(","),
    });
    new CfnOutput(this, "SubredesPublicas", {
      value: vpc.publicSubnets.map((s) => s.subnetId).join(","),
    });
  }
}

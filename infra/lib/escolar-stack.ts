import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
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
  /** Certificado de ACM para HTTPS. Obligatorio en prod; en dev, sin él el panel queda en HTTP (solo pruebas). */
  certificateArn?: string;
  /** Correo que recibe las alarmas (se confirma desde el correo que manda AWS). */
  alertEmail?: string;
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
    if (isProd && !props.certificateArn) {
      throw new Error(
        "En producción hace falta HTTPS: crea el certificado del dominio en ACM y pásalo con -c certificateArn=arn:... (ver docs/despliegue.md)",
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
      // 100 centros: t4g.small (2 GB) en prod; t4g.micro alcanza para pruebas.
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        isProd ? ec2.InstanceSize.SMALL : ec2.InstanceSize.MICRO,
      ),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      credentials: rds.Credentials.fromGeneratedSecret("escolar"),
      databaseName: "escolar_identity",
      allocatedStorage: 20,
      maxAllocatedStorage: isProd ? 200 : 100,
      storageEncrypted: true,
      publiclyAccessible: false,
      multiAz: isProd,
      // Respaldos automáticos con restauración a cualquier minuto de los últimos 30 días (prod).
      backupRetention: Duration.days(isProd ? 30 : 3),
      copyTagsToSnapshot: true,
      enablePerformanceInsights: isProd,
      deletionProtection: isProd,
      removalPolicy: isProd ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
      cloudwatchLogsExports: ["postgresql"],
    });
    const dbSecret = database.secret;
    if (!dbSecret) throw new Error("RDS no generó el secreto de credenciales");

    const jwtSecret = secretsmanager.Secret.fromSecretCompleteArn(this, "JwtSecret", props.jwtSecretArn);

    /** En prod: de 2 a 4 tareas según el uso de CPU (p. ej. a la hora de tomar asistencia). */
    const autoscale = (service: ecs.FargateService) => {
      service
        .autoScaleTaskCount({ minCapacity: 2, maxCapacity: 4 })
        .scaleOnCpuUtilization("Cpu", { targetUtilizationPercent: 60 });
    };

    // ───────────────────────────── Microservicios ─────────────────────────────
    /**
     * Un microservicio interno: Fargate, sin entrada desde internet, publicado por Service Connect
     * como http://<nombre>:<puerto>, con su propia base de datos dentro del mismo RDS
     * (el servicio la crea al arrancar si no existe) y rollback automático si no arranca sano.
     */
    const backendService = (
      name: string,
      options: {
        port: number;
        environment?: Record<string, string>;
        secrets?: Record<string, ecs.Secret>;
        /** CPU y memoria en prod (en dev siempre 256/512). */
        prodSize?: { cpu: number; memoryLimitMiB: number };
      },
    ) => {
      const id = name.charAt(0).toUpperCase() + name.slice(1);
      const size = isProd && options.prodSize ? options.prodSize : { cpu: 256, memoryLimitMiB: 512 };
      const task = new ecs.FargateTaskDefinition(this, `${id}Task`, {
        ...size,
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
      if (isProd) autoscale(service);
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
      // Tableros y seguimiento recorren muchos datos: más CPU en prod.
      prodSize: { cpu: 512, memoryLimitMiB: 1024 },
    });
    identityService.connections.allowFrom(academic.service, ec2.Port.tcp(3001), "academic -> identity");

    // ───────────────────────────── Frontend web ─────────────────────────────
    const certificate = props.certificateArn
      ? acm.Certificate.fromCertificateArn(this, "Certificado", props.certificateArn)
      : undefined;

    const web = new ecsPatterns.ApplicationLoadBalancedFargateService(this, "Web", {
      cluster,
      cpu: isProd ? 512 : 256,
      memoryLimitMiB: isProd ? 1024 : 512,
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
    if (isProd) autoscale(web.service);

    // ───────────────────────────── Protección (WAF, prod) ─────────────────────────────
    if (isProd) {
      const waf = new wafv2.CfnWebACL(this, "Waf", {
        scope: "REGIONAL",
        defaultAction: { allow: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: "escolar-waf",
          sampledRequestsEnabled: true,
        },
        rules: [
          {
            // Además del bloqueo por cuenta: una IP no puede intentar iniciar sesión más de 100 veces en 5 min.
            name: "limite-inicio-de-sesion",
            priority: 0,
            action: { block: {} },
            statement: {
              rateBasedStatement: {
                limit: 100,
                aggregateKeyType: "IP",
                scopeDownStatement: {
                  byteMatchStatement: {
                    fieldToMatch: { uriPath: {} },
                    positionalConstraint: "STARTS_WITH",
                    searchString: "/login",
                    textTransformations: [{ priority: 0, type: "LOWERCASE" }],
                  },
                },
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: "limite-login",
              sampledRequestsEnabled: true,
            },
          },
          ...["AWSManagedRulesAmazonIpReputationList", "AWSManagedRulesKnownBadInputsRuleSet"].map(
            (rule, i) => ({
              name: rule,
              priority: i + 1,
              overrideAction: { none: {} },
              statement: { managedRuleGroupStatement: { vendorName: "AWS", name: rule } },
              visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: rule,
                sampledRequestsEnabled: true,
              },
            }),
          ),
        ],
      });
      new wafv2.CfnWebACLAssociation(this, "WafAlb", {
        resourceArn: web.loadBalancer.loadBalancerArn,
        webAclArn: waf.attrArn,
      });
    }

    // ───────────────────────────── Alarmas ─────────────────────────────
    const alerts = new sns.Topic(this, "Alertas", { displayName: "Plataforma Escolar: alertas" });
    if (props.alertEmail) alerts.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));
    const alarm = (
      id: string,
      description: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      periods = 3,
    ) => {
      const a = new cloudwatch.Alarm(this, id, {
        alarmDescription: description,
        metric,
        threshold,
        evaluationPeriods: periods,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      a.addAlarmAction(new cwActions.SnsAction(alerts));
      a.addOkAction(new cwActions.SnsAction(alerts));
      return a;
    };
    const fiveMinutes = Duration.minutes(5);
    alarm(
      "AlarmaErrores5xx",
      "El panel está respondiendo errores (5xx)",
      web.loadBalancer.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { period: fiveMinutes }),
      20,
      2,
    );
    alarm(
      "AlarmaPanelCaido",
      "El balanceador no tiene ninguna tarea sana del panel",
      web.targetGroup.metrics.unhealthyHostCount({ period: Duration.minutes(1) }),
      1,
      5,
    );
    for (const [id, service] of [
      ["Web", web.service],
      ["Identity", identityService],
      ["Academic", academic.service],
    ] as const) {
      alarm(
        `AlarmaCpu${id}`,
        `${id}: CPU alta por 15 minutos`,
        service.metricCpuUtilization({ period: fiveMinutes }),
        85,
      );
      alarm(
        `AlarmaMemoria${id}`,
        `${id}: memoria alta por 15 minutos`,
        service.metricMemoryUtilization({ period: fiveMinutes }),
        90,
      );
    }
    alarm(
      "AlarmaBaseCpu",
      "Base de datos: CPU alta por 15 minutos",
      database.metricCPUUtilization({ period: fiveMinutes }),
      80,
    );
    new cloudwatch.Alarm(this, "AlarmaBaseDisco", {
      alarmDescription: "Base de datos: queda poco disco (menos de 5 GB)",
      metric: database.metricFreeStorageSpace({ period: fiveMinutes }),
      threshold: 5 * 1024 ** 3,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    }).addAlarmAction(new cwActions.SnsAction(alerts));
    new cloudwatch.Alarm(this, "AlarmaBaseMemoria", {
      alarmDescription: "Base de datos: queda poca memoria (menos de 150 MB)",
      metric: database.metricFreeableMemory({ period: fiveMinutes }),
      threshold: 150 * 1024 ** 2,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    }).addAlarmAction(new cwActions.SnsAction(alerts));

    // ───────────────────────────── Salidas ─────────────────────────────
    new CfnOutput(this, "UrlPanel", {
      value: `${certificate ? "https" : "http"}://${web.loadBalancer.loadBalancerDnsName}`,
    });
    new CfnOutput(this, "NombreCluster", { value: cluster.clusterName });
    new CfnOutput(this, "TemaAlertas", { value: alerts.topicArn });
    new CfnOutput(this, "BaseDeDatos", { value: database.instanceIdentifier });
    new CfnOutput(this, "IdentityTaskDefinition", { value: identity.task.family });
    new CfnOutput(this, "IdentitySecurityGroup", {
      value: identityService.connections.securityGroups.map((sg) => sg.securityGroupId).join(","),
    });
    new CfnOutput(this, "SubredesPublicas", {
      value: vpc.publicSubnets.map((s) => s.subnetId).join(","),
    });
  }
}

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
import * as s3 from "aws-cdk-lib/aws-s3";
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
  /**
   * ARN del secreto con la llave de la API de Claude (el valor del secreto es la llave). Opcional:
   * sin él, el asistente de planificación aparece como no disponible.
   */
  anthropicSecretArn?: string;
  /**
   * ARN del secreto con la llave de la API de Gemini (Google; el valor del secreto es la llave).
   * Opcional. Si se indica, el asistente de planificación usa Gemini aunque también haya llave de
   * Claude. `geminiModel` fija la versión (por defecto, el Flash más reciente).
   */
  geminiSecretArn?: string;
  geminiModel?: string;
  /**
   * ARN del secreto con la llave de la API de Groq (el valor del secreto es la llave). Opcional. Si
   * se indica (y no hay de Gemini), el asistente usa Groq aunque también haya llave de Claude.
   * `groqModel` elige el modelo (por defecto, GPT-OSS 120B).
   */
  groqSecretArn?: string;
  groqModel?: string;
  /**
   * ARN del secreto con las llaves de los avisos de mensajes al celular (VAPID_PUBLIC_KEY,
   * VAPID_PRIVATE_KEY, VAPID_SUBJECT; se generan con `pnpm push:keys`). Opcional: sin él los
   * mensajes funcionan, pero el teléfono no avisa.
   */
  pushSecretArn?: string;
  /**
   * ARN del secreto con la cuenta de servicio de Firebase (clave FCM_SERVICE_ACCOUNT: el JSON que
   * descarga Firebase) para los avisos a la app de Android. Opcional: sin él la app funciona sin
   * avisos.
   */
  fcmSecretArn?: string;
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
      // Respaldos y mantenimiento de madrugada en Honduras (UTC-6), nunca en horario de clases:
      // respaldo diario a la 1:00 a. m. y actualizaciones de AWS los domingos a las 2:00 a. m.
      preferredBackupWindow: "07:00-07:30",
      preferredMaintenanceWindow: "Sun:08:00-Sun:08:30",
      // Registra las consultas que tardan más de 1 s, para encontrar lo lento antes de que se note.
      parameterGroup: new rds.ParameterGroup(this, "ParametrosPostgres", {
        engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
        parameters: { log_min_duration_statement: "1000" },
      }),
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
        /** Cuánto espera Service Connect cada respuesta (15 s por defecto). */
        requestTimeout?: Duration;
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
        // Solo revisa que el proceso responda (/health), no la base (/health/ready): si la base se
        // reinicia o cambia de zona por un par de minutos, las tareas siguen vivas y se recuperan
        // solas en cuanto vuelve, en vez de que ECS las reemplace todas a la vez.
        healthCheck: {
          command: [
            "CMD-SHELL",
            `node -e "fetch('http://localhost:${options.port}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`,
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
          services: [
            {
              portMappingName: name,
              dnsName: name,
              port: options.port,
              ...(options.requestTimeout ? { perRequestTimeout: options.requestTimeout } : {}),
            },
          ],
        },
      });
      database.connections.allowDefaultPortFrom(service, `${name} -> Postgres`);
      if (isProd) autoscale(service);
      return { task, service };
    };

    const pushSecret = props.pushSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(this, "PushSecret", props.pushSecretArn)
      : undefined;
    const fcmSecret = props.fcmSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(this, "FcmSecret", props.fcmSecretArn)
      : undefined;
    // Fotos, videos y documentos de los mensajes: bucket privado y cifrado, solo por HTTPS. No hay
    // enlaces públicos: identity entrega cada archivo después de revisar quién lo pide.
    const attachmentsBucket = new s3.Bucket(this, "Adjuntos", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      // En producción se guardan versiones: si un archivo se borra o se sobrescribe por error, la
      // versión anterior se puede recuperar durante 90 días.
      versioned: isProd,
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: Duration.days(1),
          ...(isProd ? { noncurrentVersionExpiration: Duration.days(90) } : {}),
        },
      ],
    });
    // Identity llega a S3 por dentro de la VPC (sin costo y sin pasar por internet).
    vpc.addGatewayEndpoint("S3", {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PUBLIC }],
    });

    const identity = backendService("identity", {
      port: 3001,
      environment: { FILES_BUCKET: attachmentsBucket.bucketName, AWS_REGION: this.region },
      // Un video puede tardar minutos en bajar con una conexión lenta: Service Connect no lo corta.
      requestTimeout: Duration.minutes(10),
      secrets: {
        JWT_KEY_ID: ecs.Secret.fromSecretsManager(jwtSecret, "JWT_KEY_ID"),
        JWT_PRIVATE_KEY: ecs.Secret.fromSecretsManager(jwtSecret, "JWT_PRIVATE_KEY"),
        JWT_PUBLIC_KEY: ecs.Secret.fromSecretsManager(jwtSecret, "JWT_PUBLIC_KEY"),
        // Avisos de mensajes al celular: identity los manda directo a los servicios de avisos de
        // Google, Apple y Mozilla (sale a internet por su IP pública, como hacia ECR).
        ...(pushSecret
          ? {
              VAPID_PUBLIC_KEY: ecs.Secret.fromSecretsManager(pushSecret, "VAPID_PUBLIC_KEY"),
              VAPID_PRIVATE_KEY: ecs.Secret.fromSecretsManager(pushSecret, "VAPID_PRIVATE_KEY"),
              VAPID_SUBJECT: ecs.Secret.fromSecretsManager(pushSecret, "VAPID_SUBJECT"),
            }
          : {}),
        // Avisos a la app de Android, por Firebase (también sale a internet por su IP pública).
        ...(fcmSecret
          ? { FCM_SERVICE_ACCOUNT: ecs.Secret.fromSecretsManager(fcmSecret, "FCM_SERVICE_ACCOUNT") }
          : {}),
      },
    });
    const identityService = identity.service;
    attachmentsBucket.grantReadWrite(identity.task.taskRole);

    /** Asistente de planificación: la llave del proveedor llega como secreto, nunca en claro. */
    const assistantSettings = () => {
      const secrets: Record<string, ecs.Secret> = {};
      const environment: Record<string, string> = { IDENTITY_URL: "http://identity:3001" };
      if (props.anthropicSecretArn) {
        secrets.ANTHROPIC_API_KEY = ecs.Secret.fromSecretsManager(
          secretsmanager.Secret.fromSecretCompleteArn(this, "AnthropicKey", props.anthropicSecretArn),
        );
      }
      if (props.geminiSecretArn) {
        secrets.GEMINI_API_KEY = ecs.Secret.fromSecretsManager(
          secretsmanager.Secret.fromSecretCompleteArn(this, "GeminiKey", props.geminiSecretArn),
        );
        if (props.geminiModel) environment.GEMINI_MODEL = props.geminiModel;
      }
      if (props.groqSecretArn) {
        secrets.GROQ_API_KEY = ecs.Secret.fromSecretsManager(
          secretsmanager.Secret.fromSecretCompleteArn(this, "GroqKey", props.groqSecretArn),
        );
        if (props.groqModel) environment.GROQ_MODEL = props.groqModel;
      }
      // Quien configura un proveedor gratuito lo quiere usar: gana sobre Claude (y Gemini sobre Groq).
      if (props.geminiSecretArn) environment.PLAN_ASSISTANT_PROVIDER = "gemini";
      else if (props.groqSecretArn) environment.PLAN_ASSISTANT_PROVIDER = "groq";
      return { environment, ...(Object.keys(secrets).length ? { secrets } : {}) };
    };

    // academic no tiene la llave privada: verifica tokens con el JWKS público de identity.
    const assistant = assistantSettings();
    const academic = backendService("academic", {
      port: 3002,
      // Tableros y seguimiento recorren muchos datos: más CPU en prod.
      prodSize: { cpu: 512, memoryLimitMiB: 1024 },
      // El asistente de IA tarda cerca de un minuto, y un libro de la biblioteca puede tardar varios
      // minutos en subir o bajar con una conexión lenta: Service Connect no lo corta.
      requestTimeout: Duration.minutes(10),
      // Libros y documentos de la biblioteca: el mismo bucket privado, bajo «biblioteca/».
      environment: {
        ...assistant.environment,
        FILES_BUCKET: attachmentsBucket.bucketName,
        AWS_REGION: this.region,
      },
      ...(assistant.secrets ? { secrets: assistant.secrets } : {}),
    });
    // academic solo puede leer y escribir en la carpeta de la biblioteca, no en los adjuntos de los mensajes.
    attachmentsBucket.grantReadWrite(academic.task.taskRole, "biblioteca/*");
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
      // El borrador del asistente de planificación tarda; el ALB corta a los 60 s por defecto.
      idleTimeout: Duration.minutes(3),
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
          // El balanceador reusa cada conexión hasta 3 min (idleTimeout). Next.js las cierra a los
          // 5 s por defecto, y entonces el balanceador a veces manda una petición por una conexión
          // ya cerrada y el usuario ve un «502» suelto. El servidor debe esperar más que el balanceador.
          KEEP_ALIVE_TIMEOUT: String(185_000),
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
      "AlarmaErroresBalanceador",
      "El balanceador está devolviendo errores propios (502/503/504): tareas caídas o conexiones cortadas",
      web.loadBalancer.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, { period: fiveMinutes }),
      10,
      2,
    );
    alarm(
      "AlarmaPanelLento",
      "El panel está lento: el 5 % de las peticiones más lentas tarda más de 5 s",
      web.loadBalancer.metrics.targetResponseTime({ period: fiveMinutes, statistic: "p95" }),
      5,
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
    alarm(
      "AlarmaBaseConexiones",
      "Base de datos: muchas conexiones abiertas (cerca del máximo de la instancia)",
      database.metricDatabaseConnections({ period: fiveMinutes }),
      isProd ? 150 : 60,
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

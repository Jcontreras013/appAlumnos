import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { EscolarStack } from "../lib/escolar-stack";

const JWT_ARN = "arn:aws:secretsmanager:us-east-1:111111111111:secret:escolar/dev/identity-jwt-AbCdEf";

let template: Template;

beforeAll(() => {
  const app = new App();
  const stack = new EscolarStack(app, "Test", {
    stage: "dev",
    jwtSecretArn: JWT_ARN,
    env: { account: "111111111111", region: "us-east-1" },
  });
  template = Template.fromStack(stack);
});

describe("seguridad de la infraestructura", () => {
  it("la base de datos no es pública y va cifrada", () => {
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      PubliclyAccessible: false,
      StorageEncrypted: true,
      Engine: "postgres",
    });
  });

  it("las descripciones de las reglas de red usan solo los caracteres que acepta AWS", () => {
    // EC2 rechaza el despliegue si una descripción lleva, por ejemplo, «>» o letras con tilde.
    const permitido = /^[a-zA-Z0-9. _\-:/()#,@[\]+=&;{}!$*]*$/;
    const descripciones: string[] = [];
    for (const recurso of Object.values(template.toJSON().Resources) as {
      Type: string;
      Properties?: Record<string, unknown>;
    }[]) {
      if (!recurso.Type.startsWith("AWS::EC2::SecurityGroup")) continue;
      const props = recurso.Properties ?? {};
      for (const clave of ["Description", "GroupDescription"]) {
        if (typeof props[clave] === "string") descripciones.push(props[clave] as string);
      }
      for (const lista of ["SecurityGroupIngress", "SecurityGroupEgress"]) {
        for (const regla of (props[lista] as { Description?: string }[] | undefined) ?? []) {
          if (regla.Description) descripciones.push(regla.Description);
        }
      }
    }
    expect(descripciones.length).toBeGreaterThan(5);
    expect(descripciones.filter((d) => !permitido.test(d) || d.length >= 256)).toEqual([]);
  });

  it("Postgres solo acepta conexiones de los microservicios (identity y academic)", () => {
    const [dbSgId] = Object.keys(template.findResources("AWS::EC2::SecurityGroup")).filter((id) =>
      id.startsWith("PostgresSecurityGroup"),
    );
    const rules = Object.values(template.findResources("AWS::EC2::SecurityGroupIngress")).filter((r) =>
      JSON.stringify((r as { Properties: { GroupId: unknown } }).Properties.GroupId).includes(`"${dbSgId}"`),
    ) as Array<{ Properties: Record<string, unknown> }>;
    const sources = rules.map((r) => JSON.stringify(r.Properties.SourceSecurityGroupId));
    expect(sources).toHaveLength(2);
    expect(sources.some((src) => src.includes("IdentityServiceSecurityGroup"))).toBe(true);
    expect(sources.some((src) => src.includes("AcademicServiceSecurityGroup"))).toBe(true);
    expect(sources.some((src) => src.includes("Web"))).toBe(false);
    expect(rules.every((r) => r.Properties.CidrIp === undefined)).toBe(true);
    // Y sin reglas abiertas a internet dentro del propio security group de la base
    const dbSg = template.findResources("AWS::EC2::SecurityGroup")[dbSgId ?? ""] as {
      Properties: { SecurityGroupIngress?: unknown[] };
    };
    expect(dbSg.Properties.SecurityGroupIngress ?? []).toHaveLength(0);
  });

  it("identity no queda expuesto a internet: solo web entra al puerto 3001", () => {
    const open = template.findResources("AWS::EC2::SecurityGroupIngress", {
      Properties: { FromPort: 3001, CidrIp: Match.anyValue() },
    });
    expect(Object.keys(open)).toHaveLength(0);
    template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
      FromPort: 3001,
      ToPort: 3001,
      SourceSecurityGroupId: Match.anyValue(),
    });
  });

  it("las llaves JWT y la contraseña de la base llegan como secretos, no como variables en claro", () => {
    const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
    const identity = Object.values(taskDefs).find((td) =>
      JSON.stringify(td).includes('"Name":"identity"'),
    ) as { Properties: { ContainerDefinitions: Array<Record<string, unknown>> } };
    const container = identity.Properties.ContainerDefinitions[0] as {
      Environment: Array<{ Name: string }>;
      Secrets: Array<{ Name: string }>;
    };
    const secretNames = container.Secrets.map((s) => s.Name);
    expect(secretNames).toEqual(expect.arrayContaining(["DB_PASSWORD", "JWT_PRIVATE_KEY"]));
    expect(container.Environment.map((e) => e.Name)).not.toContain("DB_PASSWORD");
    expect(container.Environment.map((e) => e.Name)).not.toContain("JWT_PRIVATE_KEY");
  });

  it("academic no recibe la llave privada JWT: solo verifica con el JWKS de identity", () => {
    const taskDefs = Object.values(template.findResources("AWS::ECS::TaskDefinition"));
    const academic = taskDefs.find((td) => JSON.stringify(td).includes('"Name":"academic"')) as {
      Properties: {
        ContainerDefinitions: Array<{
          Secrets: Array<{ Name: string }>;
          Environment: Array<{ Name: string; Value: string }>;
        }>;
      };
    };
    const container = academic.Properties.ContainerDefinitions[0];
    expect(container?.Secrets.map((s) => s.Name)).not.toContain("JWT_PRIVATE_KEY");
    expect(container?.Environment).toEqual(
      expect.arrayContaining([
        { Name: "IDENTITY_URL", Value: "http://identity:3001" },
        { Name: "DB_NAME", Value: "escolar_academic" },
      ]),
    );
  });

  it("academic solo acepta tráfico de web y puede consultar a identity", () => {
    const rules = Object.values(template.findResources("AWS::EC2::SecurityGroupIngress")) as Array<{
      Properties: { FromPort: unknown; CidrIp?: string; Description?: string };
    }>;
    const academicRules = rules.filter((r) => r.Properties.FromPort === 3002);
    expect(academicRules.map((r) => r.Properties.Description)).toEqual(["web to academic"]);
    expect(academicRules.every((r) => r.Properties.CidrIp === undefined)).toBe(true);
    expect(rules.map((r) => r.Properties.Description)).toContain("academic to identity");
    expect(rules.map((r) => r.Properties.Description)).toContain("academic to Postgres");
  });

  it("los despliegues fallidos se revierten solos", () => {
    template.allResourcesProperties("AWS::ECS::Service", {
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
  });

  it("el asistente y los libros de la biblioteca tienen tiempo (Service Connect y balanceador)", () => {
    const academic = Object.entries(template.findResources("AWS::ECS::Service")).find(([id]) =>
      id.startsWith("AcademicService"),
    )?.[1] as { Properties: { ServiceConnectConfiguration: { Services: Array<Record<string, unknown>> } } };
    expect(academic.Properties.ServiceConnectConfiguration.Services[0]).toMatchObject({
      Timeout: { PerRequestTimeoutSeconds: 600 },
    });
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
      LoadBalancerAttributes: Match.arrayWith([{ Key: "idle_timeout.timeout_seconds", Value: "180" }]),
    });
  });

  it("bucket privado y cifrado: identity para los mensajes, academic solo en «biblioteca/»", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
      },
    });
    // Solo por HTTPS.
    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: "Deny", Condition: { Bool: { "aws:SecureTransport": "false" } } }),
        ]),
      },
    });
    const tasks = template.findResources("AWS::ECS::TaskDefinition");
    const env = (prefix: string) => {
      const task = Object.entries(tasks).find(([id]) => id.startsWith(prefix))?.[1] as
        | { Properties: { ContainerDefinitions: Array<{ Environment?: Array<{ Name: string }> }> } }
        | undefined;
      return task?.Properties.ContainerDefinitions[0]?.Environment?.map((e) => e.Name) ?? [];
    };
    expect(env("IdentityTask")).toContain("FILES_BUCKET");
    expect(env("AcademicTask")).toContain("FILES_BUCKET");
    // Solo identity y academic escriben en el bucket; academic, únicamente bajo «biblioteca/».
    const policies = Object.entries(template.findResources("AWS::IAM::Policy")).filter(([, p]) =>
      JSON.stringify(p).includes("s3:PutObject"),
    );
    const roles = policies.map(([id]) => id);
    expect(roles.some((id) => id.startsWith("IdentityTaskTaskRole"))).toBe(true);
    expect(
      roles.every((id) => id.startsWith("IdentityTaskTaskRole") || id.startsWith("AcademicTaskTaskRole")),
    ).toBe(true);
    const academicPolicy = JSON.stringify(
      policies.find(([id]) => id.startsWith("AcademicTaskTaskRole"))?.[1],
    );
    expect(academicPolicy).toContain("/biblioteca/*");
    template.hasResourceProperties("AWS::EC2::VPCEndpoint", { VpcEndpointType: "Gateway" });
  });

  it("un video largo no se corta entre web e identity", () => {
    const identity = Object.entries(template.findResources("AWS::ECS::Service")).find(([id]) =>
      id.startsWith("IdentityService"),
    )?.[1] as { Properties: { ServiceConnectConfiguration: { Services: Array<Record<string, unknown>> } } };
    expect(identity.Properties.ServiceConnectConfiguration.Services[0]).toMatchObject({
      Timeout: { PerRequestTimeoutSeconds: 600 },
    });
  });

  it("si la base se reinicia, ECS no reemplaza las tareas: la revisión de salud no depende de ella", () => {
    const tasks = Object.entries(template.findResources("AWS::ECS::TaskDefinition"));
    for (const prefix of ["IdentityTask", "AcademicTask"]) {
      const task = tasks.find(([id]) => id.startsWith(prefix))?.[1] as {
        Properties: { ContainerDefinitions: Array<{ HealthCheck: { Command: string[] } }> };
      };
      const command = task.Properties.ContainerDefinitions[0]?.HealthCheck.Command.join(" ") ?? "";
      expect(command).toContain("/health'");
      expect(command).not.toContain("/health/ready");
    }
  });

  it("el panel mantiene las conexiones más tiempo que el balanceador (sin 502 sueltos)", () => {
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: "web",
          Environment: Match.arrayWith([{ Name: "KEEP_ALIVE_TIMEOUT", Value: "185000" }]),
        }),
      ]),
    });
  });

  it("la base de pruebas cabe en el plan gratuito de AWS (1 día de respaldos, 20 GB fijos, micro)", () => {
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      DBInstanceClass: "db.t4g.micro",
      BackupRetentionPeriod: 1,
      AllocatedStorage: "20",
      MaxAllocatedStorage: Match.absent(),
      MultiAZ: false,
    });
  });

  it("respaldos y mantenimiento de la base de madrugada en Honduras, y registro de consultas lentas", () => {
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      PreferredBackupWindow: "07:00-07:30",
      PreferredMaintenanceWindow: "Sun:08:00-Sun:08:30",
    });
    template.hasResourceProperties("AWS::RDS::DBParameterGroup", {
      Parameters: { log_min_duration_statement: "1000" },
    });
  });

  it("la llave de Claude llega como secreto a academic, solo si se indica", () => {
    const withoutKey = JSON.stringify(template.findResources("AWS::ECS::TaskDefinition"));
    expect(withoutKey).not.toContain("ANTHROPIC_API_KEY");
    const stack = new EscolarStack(new App(), "ConAsistente", {
      stage: "dev",
      jwtSecretArn: JWT_ARN,
      anthropicSecretArn: "arn:aws:secretsmanager:us-east-1:111111111111:secret:escolar/dev/anthropic-AbCdEf",
      env: { account: "111111111111", region: "us-east-1" },
    });
    const tasks = Template.fromStack(stack).findResources("AWS::ECS::TaskDefinition");
    const academic = Object.entries(tasks).find(([id]) => id.startsWith("AcademicTask"))?.[1] as {
      Properties: {
        ContainerDefinitions: Array<{
          Secrets?: Array<{ Name: string }>;
          Environment?: Array<{ Name: string }>;
        }>;
      };
    };
    const container = academic.Properties.ContainerDefinitions[0];
    expect(container?.Secrets?.map((s) => s.Name)).toContain("ANTHROPIC_API_KEY");
    expect(container?.Environment?.map((e) => e.Name)).not.toContain("ANTHROPIC_API_KEY");
  });

  it("con la llave de Gemini, academic usa Gemini y la llave llega como secreto", () => {
    const stack = new EscolarStack(new App(), "ConGemini", {
      stage: "dev",
      jwtSecretArn: JWT_ARN,
      geminiSecretArn: "arn:aws:secretsmanager:us-east-1:111111111111:secret:escolar/dev/gemini-AbCdEf",
      geminiModel: "gemini-3.5-flash",
      env: { account: "111111111111", region: "us-east-1" },
    });
    const tasks = Template.fromStack(stack).findResources("AWS::ECS::TaskDefinition");
    const academic = Object.entries(tasks).find(([id]) => id.startsWith("AcademicTask"))?.[1] as {
      Properties: {
        ContainerDefinitions: Array<{
          Secrets?: Array<{ Name: string }>;
          Environment?: Array<{ Name: string; Value: string }>;
        }>;
      };
    };
    const container = academic.Properties.ContainerDefinitions[0];
    expect(container?.Secrets?.map((s) => s.Name)).toContain("GEMINI_API_KEY");
    expect(container?.Environment).toEqual(
      expect.arrayContaining([
        { Name: "PLAN_ASSISTANT_PROVIDER", Value: "gemini" },
        { Name: "GEMINI_MODEL", Value: "gemini-3.5-flash" },
        { Name: "IDENTITY_URL", Value: "http://identity:3001" },
      ]),
    );
    expect(container?.Environment?.map((e) => e.Name)).not.toContain("GEMINI_API_KEY");
  });

  it("con la llave de Groq, academic usa Groq y la llave llega como secreto", () => {
    const stack = new EscolarStack(new App(), "ConGroq", {
      stage: "dev",
      jwtSecretArn: JWT_ARN,
      groqSecretArn: "arn:aws:secretsmanager:us-east-1:111111111111:secret:escolar/dev/groq-AbCdEf",
      groqModel: "openai/gpt-oss-20b",
      env: { account: "111111111111", region: "us-east-1" },
    });
    const tasks = Template.fromStack(stack).findResources("AWS::ECS::TaskDefinition");
    const academic = Object.entries(tasks).find(([id]) => id.startsWith("AcademicTask"))?.[1] as {
      Properties: {
        ContainerDefinitions: Array<{
          Secrets?: Array<{ Name: string }>;
          Environment?: Array<{ Name: string; Value: string }>;
        }>;
      };
    };
    const container = academic.Properties.ContainerDefinitions[0];
    expect(container?.Secrets?.map((s) => s.Name)).toContain("GROQ_API_KEY");
    expect(container?.Environment).toEqual(
      expect.arrayContaining([
        { Name: "PLAN_ASSISTANT_PROVIDER", Value: "groq" },
        { Name: "GROQ_MODEL", Value: "openai/gpt-oss-20b" },
      ]),
    );
    expect(container?.Environment?.map((e) => e.Name)).not.toContain("GROQ_API_KEY");
  });

  it("las llaves de los avisos al celular llegan como secretos a identity, solo si se indican", () => {
    const withoutPush = JSON.stringify(template.findResources("AWS::ECS::TaskDefinition"));
    expect(withoutPush).not.toContain("VAPID_PRIVATE_KEY");
    expect(withoutPush).not.toContain("FCM_SERVICE_ACCOUNT");
    const stack = new EscolarStack(new App(), "ConAvisos", {
      stage: "dev",
      jwtSecretArn: JWT_ARN,
      pushSecretArn: "arn:aws:secretsmanager:us-east-1:111111111111:secret:escolar/dev/push-AbCdEf",
      fcmSecretArn: "arn:aws:secretsmanager:us-east-1:111111111111:secret:escolar/dev/fcm-AbCdEf",
      env: { account: "111111111111", region: "us-east-1" },
    });
    const tasks = Template.fromStack(stack).findResources("AWS::ECS::TaskDefinition");
    const identity = Object.entries(tasks).find(([id]) => id.startsWith("IdentityTask"))?.[1] as {
      Properties: { ContainerDefinitions: Array<{ Secrets?: Array<{ Name: string }> }> };
    };
    expect(identity.Properties.ContainerDefinitions[0]?.Secrets?.map((s) => s.Name)).toEqual(
      expect.arrayContaining([
        "VAPID_PUBLIC_KEY",
        "VAPID_PRIVATE_KEY",
        "VAPID_SUBJECT",
        "FCM_SERVICE_ACCOUNT",
      ]),
    );
  });

  it("falla con un mensaje claro si falta el secreto JWT", () => {
    expect(() => new EscolarStack(new App(), "SinSecreto", { stage: "dev" })).toThrow(/jwtSecretArn/);
  });
});

describe("producción (100 centros)", () => {
  const CERT = "arn:aws:acm:us-east-1:111111111111:certificate/abcd-1234";
  let prod: Template;

  beforeAll(() => {
    const stack = new EscolarStack(new App(), "Prod", {
      stage: "prod",
      jwtSecretArn: JWT_ARN,
      certificateArn: CERT,
      alertEmail: "alertas@ejemplo.hn",
      env: { account: "111111111111", region: "us-east-1" },
    });
    prod = Template.fromStack(stack);
  });

  it("no se despliega sin HTTPS", () => {
    expect(
      () => new EscolarStack(new App(), "ProdSinCert", { stage: "prod", jwtSecretArn: JWT_ARN }),
    ).toThrow(/HTTPS/);
  });

  it("el correo de las alarmas no aparece en el nombre de ningún recurso (el registro de GitHub es público)", () => {
    const ids = Object.keys(prod.toJSON().Resources).join(" ").toLowerCase();
    expect(ids).not.toContain("alertas@");
    expect(ids).not.toContain("ejemplohn");
    expect(ids).not.toContain("alertasejemplo");
  });

  it("base de datos en dos zonas, protegida contra borrado y con 30 días de respaldos", () => {
    prod.hasResourceProperties("AWS::RDS::DBInstance", {
      DBInstanceClass: "db.t4g.small",
      MultiAZ: true,
      DeletionProtection: true,
      BackupRetentionPeriod: 30,
      StorageEncrypted: true,
      EnablePerformanceInsights: true,
    });
  });

  it("en producción el bucket de adjuntos se conserva aunque se borre el stack, con versiones por 90 días", () => {
    prod.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" });
    prod.hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: { Status: "Enabled" },
      LifecycleConfiguration: {
        Rules: [Match.objectLike({ NoncurrentVersionExpiration: { NoncurrentDays: 90 } })],
      },
    });
  });

  it("los tres servicios escalan de 2 a 4 tareas según la CPU", () => {
    const targets = prod.findResources("AWS::ApplicationAutoScaling::ScalableTarget");
    expect(Object.keys(targets)).toHaveLength(3);
    for (const target of Object.values(targets)) {
      expect(target.Properties).toMatchObject({ MinCapacity: 2, MaxCapacity: 4 });
    }
  });

  it("WAF frente al balanceador con límite de intentos de inicio de sesión por IP", () => {
    prod.hasResourceProperties("AWS::WAFv2::WebACL", {
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: "limite-inicio-de-sesion",
          Statement: { RateBasedStatement: Match.objectLike({ Limit: 100, AggregateKeyType: "IP" }) },
        }),
      ]),
    });
    prod.resourceCountIs("AWS::WAFv2::WebACLAssociation", 1);
  });

  it("alarmas por correo: errores, panel caído o lento, CPU, memoria y base de datos", () => {
    expect(Object.keys(prod.findResources("AWS::CloudWatch::Alarm")).length).toBeGreaterThanOrEqual(14);
    prod.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "HTTPCode_ELB_5XX_Count",
    });
    prod.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "TargetResponseTime",
      ExtendedStatistic: "p95",
      Threshold: 5,
    });
    prod.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "DatabaseConnections",
      Threshold: 150,
    });
    prod.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "alertas@ejemplo.hn",
    });
  });

  it("HTTP redirige a HTTPS y las cookies van solo por HTTPS", () => {
    prod.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Protocol: "HTTP",
      DefaultActions: [Match.objectLike({ Type: "redirect" })],
    });
    prod.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: "web",
          Environment: Match.arrayWith([{ Name: "COOKIE_SECURE", Value: "true" }]),
        }),
      ]),
    });
  });

  it("el ambiente de pruebas sigue siendo barato: sin WAF ni autoescalado", () => {
    template.resourceCountIs("AWS::WAFv2::WebACL", 0);
    template.resourceCountIs("AWS::ApplicationAutoScaling::ScalableTarget", 0);
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      DBInstanceClass: "db.t4g.micro",
      MultiAZ: false,
    });
  });
});

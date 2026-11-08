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
    expect(academicRules.map((r) => r.Properties.Description)).toEqual(["web -> academic"]);
    expect(academicRules.every((r) => r.Properties.CidrIp === undefined)).toBe(true);
    expect(rules.map((r) => r.Properties.Description)).toContain("academic -> identity");
    expect(rules.map((r) => r.Properties.Description)).toContain("academic -> Postgres");
  });

  it("los despliegues fallidos se revierten solos", () => {
    template.allResourcesProperties("AWS::ECS::Service", {
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
  });

  it("falla con un mensaje claro si falta el secreto JWT", () => {
    expect(() => new EscolarStack(new App(), "SinSecreto", { stage: "dev" })).toThrow(/jwtSecretArn/);
  });
});

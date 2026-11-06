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

  it("Postgres solo acepta conexiones del servicio identity", () => {
    const [dbSgId] = Object.keys(template.findResources("AWS::EC2::SecurityGroup")).filter((id) =>
      id.startsWith("PostgresSecurityGroup"),
    );
    const rules = Object.values(template.findResources("AWS::EC2::SecurityGroupIngress")).filter((r) =>
      JSON.stringify((r as { Properties: { GroupId: unknown } }).Properties.GroupId).includes(`"${dbSgId}"`),
    ) as Array<{ Properties: Record<string, unknown> }>;
    expect(rules).toHaveLength(1);
    expect(JSON.stringify(rules[0]?.Properties.SourceSecurityGroupId)).toContain(
      "IdentityServiceSecurityGroup",
    );
    expect(rules[0]?.Properties.CidrIp).toBeUndefined();
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

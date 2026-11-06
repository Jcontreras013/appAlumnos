import { App, Tags } from "aws-cdk-lib";
import { EscolarStack, type Stage } from "../lib/escolar-stack";

const app = new App();
const stage = (app.node.tryGetContext("stage") ?? "dev") as Stage;

new EscolarStack(app, `Escolar-${stage}`, {
  stage,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  jwtSecretArn: app.node.tryGetContext("jwtSecretArn"),
  certificateArn: app.node.tryGetContext("certificateArn"),
});

Tags.of(app).add("proyecto", "plataforma-escolar");
Tags.of(app).add("ambiente", stage);

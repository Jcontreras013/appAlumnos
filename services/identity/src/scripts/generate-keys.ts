/**
 * Genera un par de llaves Ed25519 para firmar los tokens.
 *   Local:  pnpm keys:generate >> services/identity/.env
 *   AWS:    pnpm keys:generate --json > jwt.json
 *           aws secretsmanager create-secret --name escolar/dev/identity-jwt --secret-string file://jwt.json
 *           rm jwt.json
 */
import { randomUUID } from "node:crypto";
import { generateSigningKeys } from "../lib/keys";

const keys = await generateSigningKeys(`identity-${randomUUID().slice(0, 8)}`);

if (process.argv.includes("--json")) {
  console.log(
    JSON.stringify({
      JWT_KEY_ID: keys.keyId,
      JWT_PRIVATE_KEY: keys.privateKeyPem.trim(),
      JWT_PUBLIC_KEY: keys.publicKeyPem.trim(),
    }),
  );
} else {
  const oneLine = (pem: string) => pem.trim().replace(/\n/g, "\\n");
  console.log(`JWT_KEY_ID=${keys.keyId}`);
  console.log(`JWT_PRIVATE_KEY="${oneLine(keys.privateKeyPem)}"`);
  console.log(`JWT_PUBLIC_KEY="${oneLine(keys.publicKeyPem)}"`);
}

import { JWT_ALGORITHM } from "@escolar/service-kit";
import {
  type CryptoKey,
  exportJWK,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  type JWK,
} from "jose";

export interface SigningKeys {
  keyId: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

export async function loadSigningKeys(input: {
  keyId: string;
  privateKeyPem: string;
  publicKeyPem: string;
}): Promise<SigningKeys> {
  return {
    keyId: input.keyId,
    privateKey: await importPKCS8(input.privateKeyPem, JWT_ALGORITHM),
    publicKey: await importSPKI(input.publicKeyPem, JWT_ALGORITHM, { extractable: true }),
  };
}

export async function generateSigningKeys(keyId = "identity-1") {
  const { privateKey, publicKey } = await generateKeyPair(JWT_ALGORITHM, { extractable: true });
  return {
    keyId,
    privateKey,
    publicKey,
    privateKeyPem: await exportPKCS8(privateKey),
    publicKeyPem: await exportSPKI(publicKey),
  };
}

export async function publicJwks(keys: SigningKeys): Promise<{ keys: JWK[] }> {
  const jwk = await exportJWK(keys.publicKey);
  return { keys: [{ ...jwk, kid: keys.keyId, alg: JWT_ALGORITHM, use: "sig" }] };
}

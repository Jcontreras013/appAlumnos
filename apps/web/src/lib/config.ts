/** URL interna del servicio de identidad. En AWS es el nombre de Service Connect (http://identity:3001). */
export function identityUrl(): string {
  return process.env.IDENTITY_URL ?? "http://localhost:3001";
}

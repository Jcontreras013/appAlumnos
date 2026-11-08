/** URLs internas de los servicios. En AWS son nombres de Service Connect (http://identity:3001). */
export function identityUrl(): string {
  return process.env.IDENTITY_URL ?? "http://localhost:3001";
}

export function academicUrl(): string {
  return process.env.ACADEMIC_URL ?? "http://localhost:3002";
}

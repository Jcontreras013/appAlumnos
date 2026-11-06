/** Health check del balanceador de carga (ALB). No toca servicios externos a propósito. */
export function GET() {
  return Response.json({ status: "ok", service: "web" });
}

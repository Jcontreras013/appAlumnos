import { isRole, type Role } from "@escolar/shared";
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import fp from "fastify-plugin";
import { type CryptoKey, createRemoteJWKSet, importSPKI, type JWTVerifyGetKey, jwtVerify } from "jose";
import { forbidden, unauthorized } from "./errors";

/**
 * Tokens de acceso de la plataforma.
 *
 * El servicio de identidad firma con una llave privada Ed25519 (EdDSA). El resto de los servicios
 * solo tiene la llave pública (o la descarga de /.well-known/jwks.json), así que pueden verificar
 * un token pero nunca emitir uno: comprometer un servicio de negocio no permite falsificar sesiones.
 */
export const ACCESS_TOKEN_ISSUER = "escolar-identity";
export const ACCESS_TOKEN_AUDIENCE = "escolar-api";
export const JWT_ALGORITHM = "EdDSA";

export interface AccessClaims {
  userId: string;
  /** Nombre para mostrar (historiales, "aprobado por"). Puede quedar desactualizado hasta 15 minutos. */
  name: string;
  /** Centro de la sesión (roles de centro). null para superadmin y direcciones regionales. */
  schoolId: string | null;
  /** Solo dirección distrital. */
  districtId: string | null;
  /** Solo dirección departamental. */
  departmentId: string | null;
  role: Role;
}

export type AccessTokenVerifier = (token: string) => Promise<AccessClaims>;

/**
 * - `publicKey` / `publicKeyPem`: llave pública local (el propio servicio de identidad, tests).
 * - `jwksUrl`: el resto de servicios descarga y cachea la llave desde identidad (permite rotarla).
 */
export type VerifierKeySource = { publicKey: CryptoKey } | { publicKeyPem: string } | { jwksUrl: string };

async function resolveKey(source: VerifierKeySource): Promise<CryptoKey | JWTVerifyGetKey> {
  if ("publicKey" in source) return source.publicKey;
  if ("publicKeyPem" in source) return importSPKI(source.publicKeyPem, JWT_ALGORITHM);
  return createRemoteJWKSet(new URL(source.jwksUrl));
}

export async function createAccessTokenVerifier(source: VerifierKeySource): Promise<AccessTokenVerifier> {
  const key = await resolveKey(source);

  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, key as CryptoKey, {
        issuer: ACCESS_TOKEN_ISSUER,
        audience: ACCESS_TOKEN_AUDIENCE,
        algorithms: [JWT_ALGORITHM],
      });
      const optionalId = (value: unknown) => (typeof value === "string" ? value : null);
      if (typeof payload.sub !== "string" || !isRole(payload.role)) {
        throw unauthorized();
      }
      const name = typeof payload.name === "string" ? payload.name : "";
      return {
        userId: payload.sub,
        name,
        schoolId: optionalId(payload.school_id),
        districtId: optionalId(payload.district_id),
        departmentId: optionalId(payload.department_id),
        role: payload.role,
      };
    } catch {
      throw unauthorized();
    }
  };
}

declare module "fastify" {
  interface FastifyRequest {
    /** Usuario autenticado. Solo está definido en rutas protegidas con `authenticate`. */
    auth: AccessClaims;
  }
  interface FastifyInstance {
    authenticate: preHandlerAsyncHookHandler;
  }
}

export const authPlugin = fp<{ verifier: AccessTokenVerifier }>(
  async (app: FastifyInstance, { verifier }) => {
    app.decorateRequest("auth", null as unknown as AccessClaims);
    app.decorate("authenticate", async (request: FastifyRequest) => {
      const header = request.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        throw unauthorized("Falta el token de acceso");
      }
      request.auth = await verifier(header.slice("Bearer ".length).trim());
    });
  },
  { name: "escolar-auth" },
);

/** preHandler que exige uno de los roles indicados. Usar después de `app.authenticate`. */
export function requireRole(...roles: Role[]): preHandlerAsyncHookHandler {
  return async (request) => {
    if (!roles.includes(request.auth.role)) {
      throw forbidden();
    }
  };
}

/**
 * Devuelve el colegio del usuario autenticado. Es la ÚNICA fuente válida del tenant en una
 * petición: nunca se toma el colegio del body ni de la URL, para que un usuario no pueda leer
 * ni modificar datos de otro colegio cambiando un id.
 */
export function tenantOf(request: FastifyRequest): string {
  const { schoolId } = request.auth;
  if (!schoolId) {
    throw forbidden("Esta acción solo está disponible para usuarios de un colegio");
  }
  return schoolId;
}

/** Ámbito regional de la sesión (direcciones departamental y distrital). */
export function regionalScopeOf(request: FastifyRequest): { type: "departamento" | "distrito"; id: string } {
  const { role, departmentId, districtId } = request.auth;
  if (role === "director_departamental" && departmentId) return { type: "departamento", id: departmentId };
  if (role === "director_distrital" && districtId) return { type: "distrito", id: districtId };
  throw forbidden("Esta vista es solo para direcciones departamentales y distritales");
}

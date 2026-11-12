import { databaseUrlFromEnv, intEnv, optionalEnv, pemEnv } from "@escolar/service-kit";

export interface TokenSettings {
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  /**
   * Ventana en la que un refresh token recién rotado todavía se acepta. Cubre el caso normal de
   * varias peticiones paralelas del navegador refrescando a la vez; fuera de esta ventana, reusar
   * un token rotado se trata como robo y se revoca toda la sesión.
   */
  refreshReuseGraceSeconds: number;
}

export interface IdentityConfig extends TokenSettings {
  port: number;
  databaseUrl: string;
  runMigrationsOnStart: boolean;
  loginRateLimitPerMinute: number;
  /** REQUIRE_MFA=false solo en demos: la verificación en dos pasos queda opcional para todos. */
  requireMfa: boolean;
  jwtKeyId: string;
  jwtPrivateKeyPem: string;
  jwtPublicKeyPem: string;
}

export const DEFAULT_TOKEN_SETTINGS: TokenSettings = {
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
  refreshReuseGraceSeconds: 30,
};

export function loadConfig(): IdentityConfig {
  return {
    port: intEnv("PORT", 3001),
    databaseUrl: databaseUrlFromEnv(),
    runMigrationsOnStart: optionalEnv("RUN_MIGRATIONS", "true") === "true",
    loginRateLimitPerMinute: intEnv("LOGIN_RATE_LIMIT_PER_MINUTE", 10),
    requireMfa: optionalEnv("REQUIRE_MFA", "true") !== "false",
    accessTokenTtlSeconds: intEnv("ACCESS_TOKEN_TTL_SECONDS", DEFAULT_TOKEN_SETTINGS.accessTokenTtlSeconds),
    refreshTokenTtlSeconds: intEnv(
      "REFRESH_TOKEN_TTL_SECONDS",
      DEFAULT_TOKEN_SETTINGS.refreshTokenTtlSeconds,
    ),
    refreshReuseGraceSeconds: intEnv(
      "REFRESH_REUSE_GRACE_SECONDS",
      DEFAULT_TOKEN_SETTINGS.refreshReuseGraceSeconds,
    ),
    jwtKeyId: optionalEnv("JWT_KEY_ID", "identity-1"),
    jwtPrivateKeyPem: pemEnv("JWT_PRIVATE_KEY"),
    jwtPublicKeyPem: pemEnv("JWT_PUBLIC_KEY"),
  };
}

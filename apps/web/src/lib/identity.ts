import "server-only";
import type {
  CreateSchoolInput,
  CreateUserInput,
  LoginResponseDto,
  MeResponseDto,
  SchoolDto,
  SchoolRole,
  TokenPairDto,
  UserDto,
} from "@escolar/shared";
import { ServiceError, serviceCall } from "./api";
import { identityUrl } from "./config";

export { ServiceError };

const call = <T>(path: string, init?: Parameters<typeof serviceCall>[2]) =>
  serviceCall<T>(identityUrl(), path, init);

export const identity = {
  login: (email: string, password: string) =>
    call<LoginResponseDto>("/auth/login", { method: "POST", body: { email, password } }),
  refresh: (refreshToken: string) =>
    call<TokenPairDto>("/auth/refresh", { method: "POST", body: { refreshToken } }),
  logout: (refreshToken: string) => call<void>("/auth/logout", { method: "POST", body: { refreshToken } }),
  me: (token: string) => call<MeResponseDto>("/me", { token }),

  listUsers: (token: string, role?: SchoolRole) =>
    call<UserDto[]>(role ? `/users?role=${role}` : "/users", { token }),
  createUser: (token: string, input: CreateUserInput) =>
    call<UserDto>("/users", { method: "POST", token, body: input }),
  setUserActive: (token: string, id: string, active: boolean) =>
    call<UserDto>(`/users/${id}/status`, { method: "POST", token, body: { active } }),

  listSchools: (token: string) => call<SchoolDto[]>("/schools", { token }),
  createSchool: (token: string, input: CreateSchoolInput) =>
    call<{ school: SchoolDto; admin: UserDto }>("/schools", { method: "POST", token, body: input }),
  uploadLogo: (token: string, imageBase64: string) =>
    call<SchoolDto>("/school/logo", { method: "PUT", token, body: { image: imageBase64 } }),
  removeLogo: (token: string) => call<SchoolDto>("/school/logo", { method: "DELETE", token }),
  /** La imagen tal cual (no es JSON): se reenvía al navegador desde /panel/logo. */
  fetchLogo: async (token: string): Promise<Response | null> => {
    const res = await fetch(`${identityUrl()}/school/logo`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    }).catch(() => {
      throw new ServiceError(503, "service_unavailable", "No se pudo cargar el logo");
    });
    return res.ok ? res : null;
  },
  setSchoolActive: (token: string, id: string, active: boolean) =>
    call<SchoolDto>(`/schools/${id}/status`, { method: "POST", token, body: { active } }),
};

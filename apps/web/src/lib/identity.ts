import "server-only";
import type {
  CreatedUserDto,
  CreateSchoolInput,
  CreateUserInput,
  DepartmentDto,
  LoginResponseDto,
  MeResponseDto,
  RegionalUserInput,
  SchoolDto,
  SchoolRole,
  ScopedSchoolDto,
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
    call<CreatedUserDto>("/users", { method: "POST", token, body: input }),
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
  switchMembership: (token: string, membershipId: string, refreshToken?: string) =>
    call<LoginResponseDto>("/auth/switch", { method: "POST", token, body: { membershipId, refreshToken } }),

  // Jerarquía (Secretaría de Educación)
  listDepartments: (token: string) => call<DepartmentDto[]>("/departments", { token }),
  createDepartment: (token: string, input: { code: string; name: string }) =>
    call<DepartmentDto>("/departments", { method: "POST", token, body: input }),
  createDistrict: (token: string, departmentId: string, name: string) =>
    call<{ id: string }>(`/departments/${departmentId}/districts`, { method: "POST", token, body: { name } }),
  createRegionalUser: (token: string, input: RegionalUserInput) =>
    call<CreatedUserDto>("/regional-users", { method: "POST", token, body: input }),
  scopeSchools: (token: string) => call<ScopedSchoolDto[]>("/scope/schools", { token }),
  fetchScopedLogo: async (token: string, schoolId: string): Promise<Response | null> => {
    const res = await fetch(`${identityUrl()}/scope/schools/${schoolId}/logo`, {
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

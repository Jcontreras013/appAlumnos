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
import { serviceCall } from "./api";
import { identityUrl } from "./config";

export { ServiceError } from "./api";

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
  setSchoolActive: (token: string, id: string, active: boolean) =>
    call<SchoolDto>(`/schools/${id}/status`, { method: "POST", token, body: { active } }),
};

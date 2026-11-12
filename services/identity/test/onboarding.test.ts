import type {
  CreatedUserDto,
  DepartmentDto,
  ImportSummaryDto,
  LoginResponseDto,
  SchoolImportRowDto,
  ScopedSchoolDto,
  StaffImportRowDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type IdentityTestContext, PASSWORD, SUPERADMIN, setupIdentity } from "./helpers";

let ctx: IdentityTestContext;
let root: string;
let departmental: string;
let department: DepartmentDto;

beforeAll(async () => {
  ctx = await setupIdentity();
  root = await ctx.tokenFor(SUPERADMIN.email, SUPERADMIN.password);
  const post = (url: string, payload: object) =>
    ctx.app.inject({ method: "POST", url, headers: ctx.auth(root), payload });
  department = (await post("/departments", { code: "11", name: "Islas de la Bahía" })).json();
  await post(`/departments/${department.id}/districts`, { name: "Roatán" });
  await post(`/departments/${department.id}/districts`, { name: "José Santos Guardiola" });
  await post("/regional-users", {
    name: "Directora Departamental",
    email: "departamental@ihb.hn",
    password: PASSWORD,
    role: "director_departamental",
    departmentId: department.id,
  });
  departmental = await ctx.tokenFor("departamental@ihb.hn");
  // Un centro que ya existe, con código C-001 y su director con cuenta.
  await post("/schools", {
    name: "Escuela Existente",
    slug: "escuela-existente",
    code: "C-001",
    sector: "publico",
    admin: { name: "Director Existente", email: "director@existente.hn", password: PASSWORD },
  });
});
afterAll(() => ctx.close());

const importSchools = (rows: object[], dryRun: boolean, token = departmental) =>
  ctx.app.inject({
    method: "POST",
    url: "/scope/schools/import",
    headers: ctx.auth(token),
    payload: { rows, dryRun },
  });
const importStaff = (rows: object[], dryRun: boolean, token: string) =>
  ctx.app.inject({
    method: "POST",
    url: "/users/import",
    headers: ctx.auth(token),
    payload: { rows, dryRun },
  });

const goodSchools = [
  {
    centro: "Escuela Prueba Uno",
    codigo: "C-100",
    distrito: "Roatán",
    director: "Ana Directora",
    identidad_director: "0801-1980-00001",
  },
  {
    centro: "Escuela Prueba Dos",
    codigo: "C-101",
    distrito: "jose santos guardiola",
    director: "Beto Director",
    correo_director: "Beto@Escuela.hn",
  },
  // Excel se comió el cero inicial de la identidad: se restaura.
  {
    centro: "Escuela Prueba Uno",
    distrito: "ROATAN",
    director: "Ceci Directora",
    identidad_director: "801198000003",
  },
];

describe("carga de centros (departamental)", () => {
  it("la vista previa marca cada error con su fila, sin crear nada", async () => {
    const res = await importSchools(
      [
        ...goodSchools.slice(0, 1),
        {
          centro: "Escuela Repetida",
          codigo: "C-001",
          distrito: "Roatán",
          director: "Doña Ruth",
          identidad_director: "0801198000009",
        },
        { centro: "Escuela Tres", distrito: "Narnia", director: "Eva", identidad_director: "123" },
        { centro: "Escuela Cuatro", distrito: "Roatán", director: "Fito" },
      ],
      true,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json<ImportSummaryDto<SchoolImportRowDto>>();
    expect(body).toMatchObject({ dryRun: true, valid: 1, invalid: 3, created: 0 });
    const [ok, dup, bad, noId] = body.rows;
    expect(ok).toMatchObject({
      row: 2,
      status: "nuevo",
      districtName: "Roatán",
      directorLogin: "0801-1980-00001",
    });
    expect(dup?.errors).toContain("Ya hay un centro con el código C-001");
    expect(bad?.errors.join(" ")).toMatch(/Distrito desconocido "Narnia".*13 dígitos/);
    expect(noId?.errors).toContain("Falta la identidad o el correo (con eso entrará)");
  });

  it("confirmar con errores no crea nada", async () => {
    const res = await importSchools(
      [...goodSchools.slice(0, 1), { centro: "X", distrito: "Roatán", director: "Y" }],
      false,
    );
    expect(res.statusCode).toBe(409);
    const scope = (
      await ctx.app.inject({ method: "GET", url: "/scope/schools", headers: ctx.auth(departmental) })
    ).json<ScopedSchoolDto[]>();
    expect(scope.map((s) => s.name)).not.toContain("Escuela Prueba Uno");
  });

  let anaTemp: string;
  it("al confirmar crea los centros y a cada director con su contraseña temporal", async () => {
    const res = await importSchools(goodSchools, false);
    expect(res.statusCode).toBe(200);
    const body = res.json<ImportSummaryDto<SchoolImportRowDto>>();
    expect(body).toMatchObject({ dryRun: false, valid: 3, created: 3 });
    anaTemp = body.rows[0]?.temporaryPassword as string;
    expect(anaTemp).toMatch(/^[A-Za-z]+-\d{4}-[A-Za-z]+$/);
    expect(body.rows[2]?.directorLogin).toBe("0801-1980-00003");

    const scope = (
      await ctx.app.inject({ method: "GET", url: "/scope/schools", headers: ctx.auth(departmental) })
    ).json<ScopedSchoolDto[]>();
    const names = scope.map((s) => s.name);
    expect(names.filter((n) => n === "Escuela Prueba Uno")).toHaveLength(2); // mismo nombre, distinto identificador
    expect(new Set(scope.map((s) => s.slug)).size).toBe(scope.length);
  });

  it("el director entra con su identidad y la contraseña temporal; dirige su centro nuevo", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "0801198000001", password: anaTemp },
    });
    const body = res.json<LoginResponseDto>();
    expect(body.user).toMatchObject({ role: "admin", mustChangePassword: true, name: "Ana Directora" });
  });

  it("solo la departamental (o la plataforma) carga centros", async () => {
    const director = await ctx.tokenFor("director@existente.hn");
    expect((await importSchools(goodSchools, true, director)).statusCode).toBe(403);
    // La plataforma debe decir de qué departamento.
    expect((await importSchools(goodSchools, true, root)).statusCode).toBe(400);
  });
});

describe("carga del personal (dirección del centro)", () => {
  let director: string;
  beforeAll(async () => {
    director = await ctx.tokenFor("director@existente.hn");
  });

  const staff = [
    { nombre: "María Maestra", identidad: "0801-1990-00010", rol: "maestra" },
    { nombre: "Coordinadora Ruiz", correo: "ruiz@existente.hn", rol: "Coordinación" },
    { nombre: "Sofía Secretaria", identidad: "0801199000011", rol: "secretaria" },
    // Ya trabaja en otro centro (dirige la Escuela Prueba Dos): solo se le agrega el acceso.
    { nombre: "Beto Director", correo: "beto@escuela.hn", rol: "" },
  ];

  it("valida cargos, identidades y repetidos", async () => {
    const res = await importStaff(
      [
        ...staff,
        { nombre: "Otra", identidad: "0801199000010", rol: "maestra" },
        { nombre: "Pepe", identidad: "0801199000012", rol: "conserje" },
      ],
      true,
      director,
    );
    const body = res.json<ImportSummaryDto<StaffImportRowDto>>();
    expect(body.rows.map((r) => r.status)).toEqual([
      "nuevo",
      "nuevo",
      "nuevo",
      "existente",
      "error",
      "error",
    ]);
    expect(body.rows[1]?.role).toBe("coordinador");
    expect(body.rows[3]?.role).toBe("docente");
    expect(body.rows[4]?.errors).toContain("Repetido con la fila 2");
    expect(body.rows[5]?.errors[0]).toContain('Cargo desconocido "conserje"');
  });

  it("al confirmar crea las cuentas nuevas con contraseña temporal y enlaza a quien ya tenía cuenta", async () => {
    const res = await importStaff(staff, false, director);
    expect(res.statusCode).toBe(200);
    const body = res.json<ImportSummaryDto<StaffImportRowDto>>();
    expect(body.created).toBe(3);
    expect(body.rows[3]).toMatchObject({ status: "existente", temporaryPassword: null });
    const temp = body.rows[0]?.temporaryPassword as string;
    const login = await ctx.login("0801-1990-00010", temp);
    expect(login.body.user).toMatchObject({ role: "docente", mustChangePassword: true });

    // Importar otra vez el mismo archivo no duplica: ya tienen acceso.
    const again = (await importStaff(staff, true, director)).json<ImportSummaryDto<StaffImportRowDto>>();
    expect(again.rows.every((r) => r.status === "ya_tiene_acceso")).toBe(true);
  });

  it("un docente o la departamental no cargan personal", async () => {
    await ctx.app.inject({
      method: "POST",
      url: "/users",
      headers: ctx.auth(director),
      payload: {
        name: "Docente Con Clave",
        email: "docente@existente.hn",
        password: PASSWORD,
        role: "docente",
      },
    });
    const teacher = await ctx.tokenFor("docente@existente.hn");
    expect((await importStaff(staff, true, teacher)).statusCode).toBe(403);
    expect((await importStaff(staff, true, departmental)).statusCode).toBe(403);
  });

  it("alta individual con identidad y sin contraseña: se genera una temporal", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/users",
      headers: ctx.auth(director),
      payload: { name: "Nuevo Docente", nationalId: "0801-1995-00020", role: "docente" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<CreatedUserDto>();
    expect(body.temporaryPassword).toBeTruthy();
    expect(body).toMatchObject({ email: null, nationalId: "0801199500020", mustChangePassword: true });
  });
});

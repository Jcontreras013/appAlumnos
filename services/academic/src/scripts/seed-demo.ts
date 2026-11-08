/**
 * Datos de demostración para el Colegio Demo, cargados A TRAVÉS DE LAS APIs (no directo a la base):
 * inicia sesión en identity como la administradora demo y llama a academic igual que lo haría el panel.
 * Requiere identity y academic corriendo, y haber corrido antes `pnpm db:seed` (identity) con SEED_DEMO=true.
 *
 *   pnpm --filter @escolar/academic db:seed
 */
import { optionalEnv, requireEnv } from "@escolar/service-kit";
import type { SchoolYearDto, SectionDto, SubjectDto, UserDto } from "@escolar/shared";

const identityUrl = optionalEnv("IDENTITY_URL", "http://localhost:3001");
const academicUrl = optionalEnv("ACADEMIC_URL", "http://localhost:3002");

async function request<T>(
  url: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url} -> ${res.status}: ${JSON.stringify(data)}`);
  return data as T;
}

const login = await request<{ accessToken: string }>(`${identityUrl}/auth/login`, {
  method: "POST",
  body: { email: "admin@colegio-demo.hn", password: requireEnv("SEED_DEMO_PASSWORD") },
});
const token = login.accessToken;
const api = <T>(path: string, method = "GET", body?: unknown) =>
  request<T>(`${academicUrl}${path}`, { method, token, body });

const existing = await api<SchoolYearDto[]>("/school-years");
if (existing.length > 0) {
  console.log("El Colegio Demo ya tiene estructura académica; no se cargó nada.");
  process.exit(0);
}

console.log("Años lectivos…");
const year = await api<SchoolYearDto>("/school-years", "POST", {
  name: "2026",
  startsOn: "2026-02-02",
  endsOn: "2026-11-27",
});
await api("/school-years", "POST", { name: "2027", startsOn: "2027-02-01", endsOn: "2027-11-26" });

console.log("Grados y secciones…");
const gradeNames = ["Kínder", "Primer grado", "Segundo grado", "Tercer grado"];
const sections: SectionDto[] = [];
for (const [order, name] of gradeNames.entries()) {
  const grade = await api<{ id: string }>("/grades", "POST", { name, sortOrder: order });
  for (const section of name === "Primer grado" ? ["A", "B"] : ["A"]) {
    sections.push(
      await api<SectionDto>("/sections", "POST", {
        schoolYearId: year.id,
        gradeId: grade.id,
        name: section,
        capacity: 25,
      }),
    );
  }
}

console.log("Materias y docentes…");
const subjects: SubjectDto[] = [];
for (const name of ["Matemáticas", "Español", "Ciencias Naturales", "Ciencias Sociales", "Inglés"]) {
  subjects.push(await api<SubjectDto>("/subjects", "POST", { name }));
}
const teachers = await request<UserDto[]>(`${identityUrl}/users?role=docente`, { token });
const subjectId = (name: string) => subjects.find((s) => s.name === name)?.id;
const firstA = sections.find((s) => s.label === "Primer grado A");
const firstB = sections.find((s) => s.label === "Primer grado B");
const assignments: Array<[SectionDto | undefined, string, UserDto | undefined]> = [
  [firstA, "Matemáticas", teachers[0]],
  [firstA, "Ciencias Naturales", teachers[0]],
  [firstB, "Matemáticas", teachers[0]],
  [firstA, "Español", teachers[1] ?? teachers[0]],
  [firstB, "Español", teachers[1] ?? teachers[0]],
  [firstA, "Inglés", teachers[1] ?? teachers[0]],
];
for (const [section, subject, teacher] of assignments) {
  if (!section || !teacher) continue;
  await api("/assignments", "POST", {
    sectionId: section.id,
    subjectId: subjectId(subject),
    teacherUserId: teacher.id,
  });
}

console.log("Alumnos (con la misma importación que usa el panel)…");
const row = (
  nombres: string,
  apellidos: string,
  grado: string,
  seccion: string,
  responsable: string,
  extra: Record<string, string> = {},
) => ({
  nombres,
  apellidos,
  grado,
  seccion,
  responsable,
  parentesco: "madre",
  telefono: "9988-7766",
  ...extra,
});
const rows = [
  row("Ana Sofía", "López Castro", "Primer grado", "A", "María Castro", {
    identidad_responsable: "0801198501234",
    fecha_nacimiento: "21/03/2019",
    sexo: "F",
    alergias: "Alergia al maní",
  }),
  row("Luis Fernando", "López Castro", "Tercer grado", "A", "María Castro", {
    identidad_responsable: "0801198501234",
    sexo: "M",
  }),
  row("Camila", "Mejía Ramos", "Primer grado", "A", "Rosa Ramos", { telefono: "3344-5566", sexo: "F" }),
  row("Mateo", "Zelaya Pineda", "Primer grado", "A", "Jorge Zelaya", {
    parentesco: "padre",
    telefono: "8877-6655",
  }),
  row("Valeria", "Hernández Cruz", "Primer grado", "B", "Lucía Cruz", { telefono: "9123-4567" }),
  row("Diego", "Martínez Flores", "Primer grado", "B", "Ana Flores", { telefono: "9765-4321" }),
  row("Isabella", "Rivera Paz", "Kínder", "A", "Carmen Paz", { telefono: "3210-9876" }),
  row("Santiago", "Rivera Paz", "Segundo grado", "A", "Carmen Paz", { telefono: "3210-9876" }),
  row("Gabriela", "Andino Reyes", "Segundo grado", "A", "Pedro Andino", {
    parentesco: "padre",
    telefono: "9456-7890",
  }),
  row("Josué", "Banegas Lagos", "Tercer grado", "A", "Elena Lagos", {
    parentesco: "abuela",
    telefono: "2234-5678",
  }),
];
const result = await api<{ created: number }>("/students/import", "POST", { rows, dryRun: false });
console.log(
  `Listo: ${result.created} alumnos matriculados en ${sections.length} secciones del año ${year.name}.`,
);

/**
 * Departamento de DEMOSTRACIÓN para presentaciones: "Islas de la Bahía" con sus cuatro distritos y
 * siete escuelas públicas FICTICIAS (todas llevan "Demo" en el nombre), maestros, alumnos, licencias
 * con y sin sustituto, y las cuentas de la dirección departamental y distrital.
 *
 * Todo se carga A TRAVÉS DE LAS APIs, igual que lo haría el panel. Requiere identity y academic
 * corriendo y el superadmin creado (`pnpm db:seed`).
 *
 *   pnpm db:seed:region
 */
import { deflateSync } from "node:zlib";
import { optionalEnv, requireEnv } from "@escolar/service-kit";
import { addDays, type DepartmentDto, todayInHonduras, type UserDto } from "@escolar/shared";

const identityUrl = optionalEnv("IDENTITY_URL", "http://localhost:3001");
const academicUrl = optionalEnv("ACADEMIC_URL", "http://localhost:3002");
const PASSWORD = requireEnv("SEED_DEMO_PASSWORD");

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

const login = async (email: string, password: string) =>
  (
    await request<{ accessToken: string }>(`${identityUrl}/auth/login`, {
      method: "POST",
      body: { email, password },
    })
  ).accessToken;

// ── Logo simple (círculos concéntricos) en PNG, sin dependencias ──
function crc32(buf: Buffer) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function emblem([r, g, b]: [number, number, number], size = 160): Buffer {
  const rows: Buffer[] = [];
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c + 0.5, y - c + 0.5) / c;
      const px =
        d > 1
          ? [0, 0, 0, 0]
          : d > 0.9
            ? [r, g, b, 255]
            : d > 0.82
              ? [255, 255, 255, 255]
              : d > 0.4
                ? [Math.min(255, r + 40), Math.min(255, g + 40), Math.min(255, b + 40), 255]
                : [255, 214, 64, 255];
      row.set(px, 1 + x * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Datos ficticios ──
const FIRST = [
  "Keisha",
  "Jamal",
  "Ana",
  "Luis",
  "Kimberly",
  "Brandon",
  "Daniela",
  "José",
  "Ashley",
  "Kevin",
  "María",
  "Carlos",
  "Tiffany",
  "Jordan",
  "Sofía",
  "Andrés",
  "Britney",
  "Dylan",
  "Valeria",
  "Héctor",
];
const LAST = [
  "Bodden",
  "McNab",
  "Ebanks",
  "Jackson",
  "Woods",
  "Martínez",
  "López",
  "Hernández",
  "Zelaya",
  "Cruz",
  "Webster",
  "Connor",
  "Brooks",
  "Mejía",
  "Rivera",
];
let seed = 7;
const rand = (n: number) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % n;
};
const pick = <T>(list: T[]) => list[rand(list.length)] as T;

const GRADES = [
  "Primer grado",
  "Segundo grado",
  "Tercer grado",
  "Cuarto grado",
  "Quinto grado",
  "Sexto grado",
];
const SUBJECTS = ["Español", "Matemáticas", "Ciencias Naturales", "Ciencias Sociales", "Inglés"];
const SCHOOLS: Array<{
  slug: string;
  name: string;
  district: string;
  grades: number;
  color: [number, number, number];
}> = [
  {
    slug: "demo-coxen-hole",
    name: "Escuela Demo Coxen Hole",
    district: "Roatán",
    grades: 6,
    color: [11, 110, 160],
  },
  {
    slug: "demo-west-end",
    name: "Escuela Demo West End",
    district: "Roatán",
    grades: 4,
    color: [160, 60, 40],
  },
  {
    slug: "demo-french-harbour",
    name: "CEB Demo French Harbour",
    district: "Roatán",
    grades: 6,
    color: [20, 130, 90],
  },
  {
    slug: "demo-oak-ridge",
    name: "Escuela Demo Oak Ridge",
    district: "José Santos Guardiola",
    grades: 5,
    color: [120, 70, 160],
  },
  {
    slug: "demo-punta-gorda",
    name: "Escuela Demo Punta Gorda",
    district: "José Santos Guardiola",
    grades: 3,
    color: [200, 120, 20],
  },
  { slug: "demo-utila", name: "Escuela Demo Utila", district: "Utila", grades: 5, color: [30, 90, 200] },
  {
    slug: "demo-bonacca",
    name: "Escuela Demo Bonacca",
    district: "Guanaja",
    grades: 4,
    color: [180, 40, 100],
  },
];

const root = await login(
  optionalEnv("SEED_SUPERADMIN_EMAIL", "superadmin@escolar.local"),
  requireEnv("SEED_SUPERADMIN_PASSWORD"),
);
const idApi = <T>(path: string, method = "GET", body?: unknown, token = root) =>
  request<T>(`${identityUrl}${path}`, { method, token, body });

const existing = (await idApi<DepartmentDto[]>("/departments")).find((d) => d.code === "11");
if (existing) {
  console.log("El departamento de demostración ya existe; no se cargó nada.");
  process.exit(0);
}

console.log("Departamento y distritos…");
const department = await idApi<DepartmentDto>("/departments", "POST", {
  code: "11",
  name: "Islas de la Bahía",
});
const districtIds: Record<string, string> = {};
for (const name of ["Roatán", "José Santos Guardiola", "Utila", "Guanaja"]) {
  districtIds[name] = (
    await idApi<{ id: string }>(`/departments/${department.id}/districts`, "POST", { name })
  ).id;
}
await idApi("/regional-users", "POST", {
  name: "Directora Departamental Demo",
  email: "departamental@demo-ihb.hn",
  password: PASSWORD,
  role: "director_departamental",
  departmentId: department.id,
});
await idApi("/regional-users", "POST", {
  name: "Director Distrital Roatán Demo",
  email: "distrital.roatan@demo-ihb.hn",
  password: PASSWORD,
  role: "director_distrital",
  districtId: districtIds["Roatán"],
});

const today = todayInHonduras();
let studentsTotal = 0;
for (const [index, school] of SCHOOLS.entries()) {
  console.log(`${school.name}…`);
  const created = await idApi<{ school: { id: string } }>("/schools", "POST", {
    name: school.name,
    slug: school.slug,
    sector: "publico",
    code: `DEMO-${String(index + 1).padStart(4, "0")}`,
    districtId: districtIds[school.district],
    admin: { name: `Dirección ${school.name}`, email: `director@${school.slug}.hn`, password: PASSWORD },
  });
  await idApi(`/schools/${created.school.id}/logo`, "PUT", {
    image: emblem(school.color).toString("base64"),
  });

  const director = await login(`director@${school.slug}.hn`, PASSWORD);
  const acApi = <T>(path: string, method = "GET", body?: unknown) =>
    request<T>(`${academicUrl}${path}`, { method, token: director, body });
  const idSchool = <T>(path: string, method = "GET", body?: unknown) =>
    request<T>(`${identityUrl}${path}`, { method, token: director, body });

  // Maestros de grado (en primaria un maestro da todas las materias de su grado)
  const teachers: UserDto[] = [];
  for (let g = 0; g < school.grades; g++) {
    const name = `${pick(["Prof.", "Profa."])} ${pick(FIRST)} ${pick(LAST)}`;
    teachers.push(
      await idSchool<UserDto>("/users", "POST", {
        name,
        email: `maestro${g + 1}@${school.slug}.hn`,
        password: PASSWORD,
        role: "docente",
      }),
    );
  }
  // Una maestra que trabaja en dos escuelas de Roatán (matutina y vespertina)
  if (school.slug === "demo-coxen-hole" || school.slug === "demo-west-end") {
    teachers.push(
      await idSchool<UserDto>("/users", "POST", {
        name: "Profa. Shanice Bodden (dos escuelas)",
        email: "shanice.bodden@demo-ihb.hn",
        password: PASSWORD,
        role: "docente",
      }),
    );
  }

  const year = await acApi<{ id: string }>("/school-years", "POST", {
    name: "2026",
    startsOn: "2026-02-02",
    endsOn: "2026-11-27",
  });
  const subjects: Record<string, string> = {};
  for (const name of SUBJECTS)
    subjects[name] = (await acApi<{ id: string }>("/subjects", "POST", { name })).id;

  const rows: Array<Record<string, string>> = [];
  const sectionsByTeacher: Array<{ sectionId: string; teacher: UserDto }> = [];
  for (let g = 0; g < school.grades; g++) {
    const gradeName = GRADES[g] as string;
    const grade = await acApi<{ id: string }>("/grades", "POST", { name: gradeName, sortOrder: g + 1 });
    const section = await acApi<{ id: string }>("/sections", "POST", {
      schoolYearId: year.id,
      gradeId: grade.id,
      name: "A",
      capacity: 30,
    });
    const teacher = teachers[g] as UserDto;
    sectionsByTeacher.push({ sectionId: section.id, teacher });
    for (const subject of SUBJECTS) {
      // Inglés lo da la maestra compartida en las dos escuelas de Roatán
      const shared = teachers.find((t) => t.email === "shanice.bodden@demo-ihb.hn");
      const who = subject === "Inglés" && shared ? shared : teacher;
      await acApi("/assignments", "POST", {
        sectionId: section.id,
        subjectId: subjects[subject],
        teacherUserId: who.id,
      });
    }
    const count = 6 + rand(9);
    for (let i = 0; i < count; i++) {
      const last = `${pick(LAST)} ${pick(LAST)}`;
      rows.push({
        nombres: pick(FIRST),
        apellidos: last,
        grado: gradeName,
        seccion: "A",
        responsable: `${pick(FIRST)} ${last.split(" ")[0]}`,
        parentesco: pick(["madre", "padre", "abuela", "tutor"]),
        telefono: `9${String(1000000 + rand(8999999)).slice(0, 7)}`,
      });
    }
  }
  const imported = await acApi<{ created: number }>("/students/import", "POST", { rows, dryRun: false });
  studentsTotal += imported.created;

  // Situaciones para el tablero
  const first = sectionsByTeacher[0];
  const second = sectionsByTeacher[1];
  if (school.slug === "demo-coxen-hole" && first && second) {
    // Licencia por enfermedad CON sustituto en todas sus clases
    const leave = await acApi<{ id: string; classes: Array<{ assignment: { id: string } }> }>(
      "/leaves",
      "POST",
      {
        teacherUserId: first.teacher.id,
        type: "enfermedad",
        startsOn: addDays(today, -2),
        endsOn: addDays(today, 3),
        notes: "Incapacidad del IHSS",
      },
    );
    for (const c of leave.classes) {
      await acApi(`/leaves/${leave.id}/substitutions`, "POST", {
        assignmentId: c.assignment.id,
        substituteUserId: second.teacher.id,
      });
    }
  }
  if (school.slug === "demo-oak-ridge" && first) {
    // Licencia de maternidad SIN sustituto todavía: aparece como alerta en el tablero
    await acApi("/leaves", "POST", {
      teacherUserId: first.teacher.id,
      type: "maternidad",
      startsOn: addDays(today, -1),
      endsOn: addDays(today, 60),
    });
  }
  if (school.slug === "demo-utila" && second) {
    await acApi("/leaves", "POST", {
      teacherUserId: second.teacher.id,
      type: "capacitacion",
      startsOn: addDays(today, 7),
      endsOn: addDays(today, 9),
      notes: "Capacitación de la Secretaría de Educación",
    });
  }
}

console.log(`Listo: ${SCHOOLS.length} escuelas, ${studentsTotal} alumnos.`);
console.log("Cuentas (contraseña SEED_DEMO_PASSWORD):");
console.log("  departamental@demo-ihb.hn       Dirección departamental");
console.log("  distrital.roatan@demo-ihb.hn    Dirección distrital de Roatán");
console.log("  director@demo-oak-ridge.hn      Dirección de escuela (tiene una clase sin maestro)");
console.log("  shanice.bodden@demo-ihb.hn      Maestra en dos escuelas");

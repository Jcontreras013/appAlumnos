/**
 * Departamento de DEMOSTRACIÓN para presentaciones: "Islas de la Bahía" con sus cuatro distritos y
 * siete escuelas públicas FICTICIAS (todas llevan "Demo" en el nombre), maestros, alumnos, licencias
 * con y sin sustituto, asistencia del último mes, notas del parcial (unas escuelas al día, otras
 * atrasadas y una que no usa el cuaderno) y las cuentas de la dirección departamental y distrital.
 * Las fechas son relativas a hoy: el IV parcial cierra en 6 días, para que se vean las alertas.
 *
 * Todo se carga A TRAVÉS DE LAS APIs, igual que lo haría el panel. Requiere identity y academic
 * corriendo y el superadmin creado (`pnpm db:seed`).
 *
 *   pnpm db:seed:region
 */
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { optionalEnv, requireEnv } from "@escolar/service-kit";
import {
  type AttendanceSheetDto,
  type AttendanceStatus,
  addDays,
  type DepartmentDto,
  type MeResponseDto,
  mondayOf,
  type PlanBoardDto,
  type PlanDetailDto,
  type PortalAccessDto,
  type StudentDetailDto,
  todayInHonduras,
  type UserDto,
} from "@escolar/shared";

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

/** Inicia sesión; si identity pide esperar (límite de intentos por minuto), espera y reintenta. */
async function login(email: string, password: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${identityUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.status === 429 && attempt < 12) {
      const seconds = Number(res.headers.get("retry-after")) || 10;
      console.log(`  (esperando ${seconds} s por el límite de inicios de sesión…)`);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      continue;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(`login ${email} -> ${res.status}: ${JSON.stringify(data)}`);
    return (data as { accessToken: string }).accessToken;
  }
}

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
  // Los bits altos: los bajos de este generador se repiten (seed % 2 alterna 0, 1, 0, 1…).
  return Math.floor((seed / 2147483648) * n);
};
const pick = <T>(list: T[]) => list[rand(list.length)] as T;

/** Otro generador para los datos del parcial cerrado: así no cambia la secuencia del resto. */
let pastSeed = 11;
const randPast = (n: number) => {
  pastSeed = (pastSeed * 1103515245 + 12345) % 2 ** 31;
  return Math.floor((pastSeed / 2 ** 31) * n);
};
const GRADES = [
  "Primer grado",
  "Segundo grado",
  "Tercer grado",
  "Cuarto grado",
  "Quinto grado",
  "Sexto grado",
];
const SUBJECTS = ["Español", "Matemáticas", "Ciencias Naturales", "Ciencias Sociales", "Inglés"];
/** Cómo lleva cada escuela el cuaderno: al día, atrasada con las notas, o sin usarlo. */
type Usage = "al_dia" | "atrasada" | "sin_uso";
const SCHOOLS: Array<{
  slug: string;
  name: string;
  district: string;
  grades: number;
  color: [number, number, number];
  usage?: Usage;
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
    usage: "atrasada",
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
    usage: "atrasada",
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
    usage: "sin_uso",
  },
];

// Prueba de carga: SEED_EXTRA_SCHOOLS=93 agrega escuelas generadas para llegar a 100 centros.
const EXTRA_DISTRICTS = ["Roatán", "José Santos Guardiola", "Utila", "Guanaja"];
for (let i = 1; i <= Number(process.env.SEED_EXTRA_SCHOOLS ?? 0); i++) {
  SCHOOLS.push({
    slug: `carga-${String(i).padStart(3, "0")}`,
    name: `Escuela Carga ${i}`,
    district: EXTRA_DISTRICTS[i % EXTRA_DISTRICTS.length] as string,
    grades: 6,
    color: [(i * 47) % 200, (i * 83) % 200, (i * 131) % 200],
    usage: i % 10 === 0 ? "sin_uso" : i % 4 === 0 ? "atrasada" : "al_dia",
  });
}

/** Inicia sesión y, si la persona trabaja en varios centros, se pasa al centro indicado. */
async function loginAt(email: string, schoolId: string): Promise<string> {
  const token = await login(email, PASSWORD);
  const me = await request<MeResponseDto>(`${identityUrl}/me`, { token });
  if (me.current.scopeId === schoolId) return token;
  const target = me.memberships.find((m) => m.scopeType === "centro" && m.scopeId === schoolId);
  if (!target) throw new Error(`${email} no tiene acceso al centro ${schoolId}`);
  const switched = await request<{ accessToken: string }>(`${identityUrl}/auth/switch`, {
    method: "POST",
    token,
    body: { membershipId: target.id },
  });
  return switched.accessToken;
}

// Identidad claramente ficticia (empieza con 0000) para la familia de la demo.
const FAMILY_DNI = "0000-2026-00001";
const FAMILY_EMAIL = "familia@demo-west-end.hn";

// ── Planificaciones de ejemplo ──
const TOPICS: Record<string, string[]> = {
  Español: [
    "El sustantivo y sus clases",
    "Comprensión lectora: el cuento",
    "Signos de puntuación",
    "El verbo",
  ],
  Matemáticas: [
    "Fracciones equivalentes",
    "Multiplicación por dos cifras",
    "Perímetro y área",
    "Suma y resta con llevadas",
  ],
  "Ciencias Naturales": [
    "El ciclo del agua",
    "Partes de la planta",
    "El arrecife de coral de Roatán",
    "El sistema digestivo",
  ],
  "Ciencias Sociales": [
    "Los municipios de Islas de la Bahía",
    "Símbolos patrios",
    "La familia y la comunidad",
    "Regiones de Honduras",
  ],
  Inglés: ["Greetings and introductions", "Numbers 1 to 100", "My family", "Daily routines"],
};

function planContent(subject: string, section: string) {
  const tema = pick(TOPICS[subject] ?? ["Repaso general"]);
  return {
    tema,
    estandar: `Al finalizar la semana, los alumnos de ${section} explican y aplican «${tema}» con ejemplos de su entorno.`,
    contenidos: `${tema}: conceptos clave, ejemplos y ejercicios guiados.`,
    actividades: {
      lunes: "Exploración de conocimientos previos con preguntas y lluvia de ideas.",
      martes: "Explicación con ejemplos en la pizarra y trabajo en parejas.",
      miercoles: "Ejercicios del libro de texto y revisión en grupo.",
      jueves: "Actividad práctica en equipos y puesta en común.",
      viernes: "Evaluación formativa y cierre del tema.",
    },
    recursos: "Libro de texto, cuaderno, láminas y material del entorno.",
    evaluacion: "Lista de cotejo del trabajo en clase y prueba corta del viernes.",
    tareas: "Ejercicios de repaso para la casa (página del libro indicada en clase).",
  };
}

type PlanState = "sin_iniciar" | "borrador" | "enviada" | "devuelta" | "aprobada";

/** Estado de cada planificación de la demo según cómo lleva el centro la planificación. */
function planState(usage: Usage, thisWeek: boolean, showcase: boolean, subject: string): PlanState {
  if (showcase && thisWeek) {
    // La maestra de la demo (maestro4@demo-west-end.hn) tiene un poco de todo para mostrar.
    return (
      ({ Matemáticas: "sin_iniciar", Español: "devuelta", "Ciencias Naturales": "aprobada" } as const)[
        subject as "Matemáticas"
      ] ?? "enviada"
    );
  }
  const roll = rand(100);
  if (!thisWeek) return roll < 85 ? "aprobada" : "enviada";
  if (usage === "atrasada") return roll < 50 ? "sin_iniciar" : roll < 75 ? "borrador" : "enviada";
  return roll < 50 ? "aprobada" : roll < 80 ? "enviada" : roll < 90 ? "devuelta" : "borrador";
}

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
  districtId: districtIds.Roatán,
});

const today = todayInHonduras();
let studentsTotal = 0;
/** Identidades ficticias de los alumnos: "0000" (ningún municipio real), año de nacimiento y correlativo. */
let studentSeq = 0;
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
  // Secretaría del centro. En las escuelas que ya usan la plataforma ya entró (cuenta en uso).
  await idSchool<UserDto>("/users", "POST", {
    name: `Secretaría ${school.name}`,
    email: `secretaria@${school.slug}.hn`,
    password: PASSWORD,
    role: "secretaria",
  });
  if ((school.usage ?? "al_dia") !== "sin_uso") await login(`secretaria@${school.slug}.hn`, PASSWORD);

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

  // Año lectivo de ~8 meses que termina en 18 días; el IV parcial es el vigente y cierra en 6.
  const year = await acApi<{ id: string }>("/school-years", "POST", {
    name: today.slice(0, 4),
    startsOn: addDays(today, -235),
    endsOn: addDays(today, 18),
  });
  const span = (name: string, from: number, to: number, close: number) => ({
    name,
    startsOn: addDays(today, from),
    endsOn: addDays(today, to),
    closesOn: addDays(today, close),
  });
  const periods = await acApi<Array<{ id: string; number: number }>>("/periods", "PUT", {
    periods: [
      span("I Parcial", -235, -176, -170),
      span("II Parcial", -175, -116, -110),
      span("III Parcial", -115, -56, -50),
      span("IV Parcial", -55, 4, 6),
    ],
  });
  const currentPeriodId = periods.find((p) => p.number === 4)?.id as string;
  const closedPeriodId = periods.find((p) => p.number === 3)?.id as string;
  const subjects: Record<string, string> = {};
  for (const name of SUBJECTS)
    subjects[name] = (await acApi<{ id: string }>("/subjects", "POST", { name })).id;

  const rows: Array<Record<string, string>> = [];
  const sectionsByTeacher: Array<{ sectionId: string; teacher: UserDto }> = [];
  const assignmentsBySection: Record<string, string[]> = {};
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
      const assignment = await acApi<{ id: string }>("/assignments", "POST", {
        sectionId: section.id,
        subjectId: subjects[subject],
        teacherUserId: who.id,
      });
      assignmentsBySection[section.id] = [...(assignmentsBySection[section.id] ?? []), assignment.id];
    }
    const count = 6 + rand(9);
    for (let i = 0; i < count; i++) {
      const last = `${pick(LAST)} ${pick(LAST)}`;
      studentSeq++;
      rows.push({
        identidad: `0000${2019 - g}${String(studentSeq).padStart(5, "0")}`,
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
  const onLeave = new Set<string>();
  const first = sectionsByTeacher[0];
  const second = sectionsByTeacher[1];
  if (school.slug === "demo-coxen-hole" && first && second) {
    // Licencia por enfermedad CON sustituto en todas sus clases
    onLeave.add(first.teacher.id);
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
    onLeave.add(first.teacher.id);
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

  // ── Cuaderno: asistencia del último mes y notas del IV parcial ──
  const usage = school.usage ?? "al_dia";
  if (usage === "sin_uso") continue;
  const schoolDays: string[] = [];
  for (let d = -30; d <= 0; d++) {
    const date = addDays(today, d);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) schoolDays.push(date);
  }
  for (const [s, { sectionId }] of sectionsByTeacher.entries()) {
    const roster = (await acApi<AttendanceSheetDto>(`/attendance/${sectionId}?fecha=${schoolDays[0]}`))
      .students;
    // Cada alumno tiene su "perfil": la mayoría asiste y rinde bien; unos pocos faltan mucho o van bajos.
    const profile = new Map(
      roster.map((r) => [
        r.studentId,
        {
          chronic: rand(16) === 0,
          ability: rand(12) === 0 ? 0.42 + rand(22) / 100 : 0.76 + rand(23) / 100,
        },
      ]),
    );
    for (const date of schoolDays) {
      // Hoy, la última sección todavía no ha tomado asistencia.
      if (date === today && s === sectionsByTeacher.length - 1) continue;
      await acApi("/attendance", "PUT", {
        sectionId,
        date,
        entries: roster.map((r) => {
          const roll = rand(100);
          const chronic = profile.get(r.studentId)?.chronic;
          const status: AttendanceStatus =
            roll < (chronic ? 30 : 3)
              ? "ausente"
              : roll < (chronic ? 34 : 7)
                ? "tarde"
                : roll < (chronic ? 36 : 9)
                  ? "justificada"
                  : "presente";
          return { studentId: r.studentId, status };
        }),
      });
    }

    const plan = [
      { name: "Tarea 1", maxPoints: 10, day: -48 },
      { name: "Trabajo en clase", maxPoints: 15, day: -40 },
      { name: "Prueba corta", maxPoints: 20, day: -30 },
      { name: "Proyecto", maxPoints: 25, day: -15 },
      { name: "Examen del parcial", maxPoints: 30, day: -3 },
    ];
    for (const assignmentId of assignmentsBySection[sectionId] ?? []) {
      // En las escuelas atrasadas, la mitad de las clases todavía no hace el examen, y en algunas
      // el maestro no ha calificado el proyecto de un alumno.
      const behind = usage === "atrasada" && rand(2) === 0;
      const ungraded = behind && rand(2) === 0 ? rand(roster.length) : -1;
      for (const [a, activity] of (behind ? plan.slice(0, 4) : plan).entries()) {
        const id = randomUUID();
        await acApi(`/activities/${id}`, "PUT", {
          id,
          assignmentId,
          periodId: currentPeriodId,
          name: activity.name,
          maxPoints: activity.maxPoints,
          date: addDays(today, activity.day),
        });
        await acApi("/scores", "PUT", {
          activityId: id,
          entries: roster.map((r, i) => {
            if (a === 3 && i === ungraded) return { studentId: r.studentId, points: null };
            const ability = profile.get(r.studentId)?.ability ?? 0.8;
            const ratio = Math.max(0, Math.min(1, ability + (rand(13) - 6) / 100));
            return { studentId: r.studentId, points: Math.round(ratio * activity.maxPoints * 2) / 2 };
          }),
        });
      }
    }

    // III Parcial (ya cerrado): completo en las escuelas al día; en las atrasadas, una de cada
    // tres clases quedó con un alumno sin la nota del examen. Con su propio generador para no
    // cambiar el resto de la demo.
    for (const [c, assignmentId] of (assignmentsBySection[sectionId] ?? []).entries()) {
      const missing = usage === "atrasada" && (s + c) % 3 === 0 ? (s + c) % Math.max(roster.length, 1) : -1;
      for (const [a, activity] of [
        { name: "Tareas del parcial", maxPoints: 30, day: -100 },
        { name: "Proyecto", maxPoints: 30, day: -80 },
        { name: "Examen del parcial", maxPoints: 40, day: -60 },
      ].entries()) {
        const id = randomUUID();
        await acApi(`/activities/${id}`, "PUT", {
          id,
          assignmentId,
          periodId: closedPeriodId,
          name: activity.name,
          maxPoints: activity.maxPoints,
          date: addDays(today, activity.day),
        });
        await acApi("/scores", "PUT", {
          activityId: id,
          entries: roster.map((r, i) => {
            if (a === 2 && i === missing) return { studentId: r.studentId, points: null };
            const ability = profile.get(r.studentId)?.ability ?? 0.8;
            const ratio = Math.max(0, Math.min(1, ability + (randPast(13) - 6) / 100));
            return { studentId: r.studentId, points: Math.round(ratio * activity.maxPoints * 2) / 2 };
          }),
        });
      }
    }
  }

  // ── Planificación semanal: la semana pasada (casi toda aprobada) y esta semana ──
  const week = mondayOf(today);
  const planned = new Set<string>();
  for (const [t, teacher] of teachers.entries()) {
    const token = await loginAt(teacher.email ?? "", created.school.id);
    const asTeacher = <T>(path: string, method = "GET", body?: unknown) =>
      request<T>(`${academicUrl}${path}`, { method, token, body });
    for (const weekStart of [addDays(week, -7), week]) {
      const thisWeek = weekStart === week;
      if (thisWeek && onLeave.has(teacher.id)) continue; // de licencia: la planifica quien la cubre
      const mine = await asTeacher<PlanBoardDto>(`/plans/mine?semana=${weekStart}`);
      for (const row of mine.rows) {
        const key = `${row.assignment.id}:${weekStart}`;
        if (planned.has(key)) continue;
        planned.add(key);
        const state = planState(
          usage,
          thisWeek,
          school.slug === "demo-west-end" && t === 3,
          row.assignment.subjectName,
        );
        if (state === "sin_iniciar") continue;
        const created = await asTeacher<PlanDetailDto>("/plans", "POST", {
          assignmentId: row.assignment.id,
          weekStart,
        });
        const id = created.plan.id;
        const content = planContent(row.assignment.subjectName, row.assignment.sectionLabel);
        if (state === "borrador") {
          await asTeacher(`/plans/${id}`, "PUT", {
            content: { tema: content.tema, contenidos: content.contenidos },
          });
          continue;
        }
        await asTeacher(`/plans/${id}/submit`, "POST", { content });
        if (state === "aprobada") await acApi(`/plans/${id}/review`, "POST", { decision: "aprobar" });
        if (state === "devuelta") {
          await acApi(`/plans/${id}/review`, "POST", {
            decision: "devolver",
            comment:
              "Las actividades del jueves y viernes son muy generales. Detalla cómo vas a evaluar el tema.",
          });
        }
      }
    }
  }

  // ── Portal de familias: una madre (ficticia) con dos hijos en West End ──
  const cuarto = sectionsByTeacher[3];
  const primero = sectionsByTeacher[0];
  if (school.slug === "demo-west-end" && cuarto && primero) {
    let guardianId = "";
    for (const sectionId of [cuarto.sectionId, primero.sectionId]) {
      const kid = (await acApi<AttendanceSheetDto>(`/attendance/${sectionId}`)).students[0];
      if (!kid) continue;
      const detail = await acApi<StudentDetailDto>(`/students/${kid.studentId}/guardians`, "POST", {
        fullName: "Keisha Bodden (demo)",
        relationship: "madre",
        nationalId: FAMILY_DNI,
        email: FAMILY_EMAIL,
        phone: "9900-0001",
      });
      guardianId = detail.guardians.find((g) => g.email === FAMILY_EMAIL)?.id ?? guardianId;
    }
    const access = await acApi<PortalAccessDto>(`/guardians/${guardianId}/portal-access`, "POST", {});
    // En la demo la cuenta queda lista: se cambia la contraseña temporal por la de la demo.
    if (access.temporaryPassword) {
      const token = await login(FAMILY_EMAIL, access.temporaryPassword);
      await request(`${identityUrl}/auth/password`, {
        method: "POST",
        token,
        body: { currentPassword: access.temporaryPassword, newPassword: PASSWORD },
      });
    }
  }
}

console.log(`Listo: ${SCHOOLS.length} escuelas, ${studentsTotal} alumnos.`);
console.log("Cuentas (contraseña SEED_DEMO_PASSWORD):");
console.log("  departamental@demo-ihb.hn       Dirección departamental");
console.log("  distrital.roatan@demo-ihb.hn    Dirección distrital de Roatán");
console.log("  director@demo-oak-ridge.hn      Dirección de escuela (tiene una clase sin maestro)");
console.log("  shanice.bodden@demo-ihb.hn      Maestra en dos escuelas");
console.log("  director@demo-west-end.hn       Dirección de escuela (atrasada con las notas)");
console.log("  maestro4@demo-west-end.hn       Maestra con su cuaderno (asistencia de hoy pendiente)");
console.log(
  "  0000-2026-00001                 Familia con dos hijos (también entra con familia@demo-west-end.hn)",
);

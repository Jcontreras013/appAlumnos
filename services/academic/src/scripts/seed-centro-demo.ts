/**
 * Datos del CENTRO DE DEMOSTRACIÓN («Centro Educativo Demostración CONECTA»): para enseñar CONECTA a
 * un colegio y para la revisión de Google Play. Todo es ficticio. Se carga A TRAVÉS DE LAS APIs, igual
 * que lo haría el panel, después de que el seed de identity (SEED_CENTRO_DEMO=true) creó el centro y
 * su personal. Las fechas son relativas a hoy. Si ya se cargó completo, no hace nada; si una carga
 * anterior se quedó a medias, sigue con lo que falta sin repetir lo que ya está.
 *
 * - Séptimo grado A (secundaria): alumnos con su cuenta del aula virtual; Matemáticas con temas,
 *   guía en PDF, avisos, clase en línea, una tarea calificada, otra abierta y un examen abierto.
 * - Primer grado A (primaria): entrega la familia.
 * - Ana Gómez, madre de Valeria (7.º) y Mateo (1.º), con su cuenta de familia.
 * - Notas de los cuatro parciales, asistencia de las últimas tres semanas y un libro en la biblioteca.
 *
 *   IDENTITY_URL=… ACADEMIC_URL=… SEED_DEMO_PASSWORD=… node dist/scripts/seed-centro-demo.js
 */

import { createHash } from "node:crypto";
import { optionalEnv, requireEnv } from "@escolar/service-kit";
import {
  type AnnouncementDto,
  type AssignmentDto,
  type AttendanceSheetDto,
  type AttendanceStatus,
  addDays,
  CENTRO_DEMO,
  type ClassPostDto,
  type ClassQuizDetailDto,
  type ClassQuizDto,
  type ClassroomDto,
  type ClassTaskDetailDto,
  type ClassTaskDto,
  type FamilyAccountDto,
  type GradeDto,
  type LibraryItemDto,
  passwordSchema,
  type QuizQuestionDto,
  type SchoolYearDto,
  type SectionDto,
  type SectionStudentAccessDto,
  type StudentDetailDto,
  type StudentListItemDto,
  type SubjectDto,
  todayInHonduras,
  type UserDto,
} from "@escolar/shared";

const identityUrl = optionalEnv("IDENTITY_URL", "http://localhost:3001");
const academicUrl = optionalEnv("ACADEMIC_URL", "http://localhost:3002");
const PASSWORD = requireEnv("SEED_DEMO_PASSWORD");
const today = todayInHonduras();

// Números siempre iguales: la demo sale igual cada vez que se carga.
let seed = 20261125;
const rand = (n: number) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % n;
};

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
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url} -> ${res.status}: ${JSON.stringify(data)}`);
  return data as T;
}

/** Inicia sesión; si identity pide esperar (límite de intentos por minuto), espera y reintenta. */
async function login(user: string, password: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${identityUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: user, password }),
    });
    if (res.status === 429 && attempt < 12) {
      const seconds = Number(res.headers.get("retry-after")) || 10;
      console.log(`  (esperando ${seconds} s por el límite de inicios de sesión…)`);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      continue;
    }
    const data = (await res.json()) as { accessToken?: string };
    if (!res.ok || !data.accessToken) throw new Error(`No se pudo entrar como ${user} (${res.status})`);
    return data.accessToken;
  }
}

/** Una cuenta recién creada (con contraseña temporal) pasa a la contraseña de la demo. */
async function settle(account: FamilyAccountDto): Promise<string> {
  if (!account.temporaryPassword) return login(account.login, PASSWORD);
  const token = await login(account.login, account.temporaryPassword);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${identityUrl}/auth/password`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: account.temporaryPassword, newPassword: PASSWORD }),
    });
    if (res.status === 429 && attempt < 12) {
      await new Promise((r) => setTimeout(r, 10_000));
      continue;
    }
    if (!res.ok) {
      // El motivo que da identity (p. ej. por qué no sirve la contraseña); nunca la contraseña.
      const reason = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error
        ?.message;
      throw new Error(
        `No se pudo poner la contraseña de la demo a ${account.login} (${res.status})${reason ? `: ${reason}` : ""}`,
      );
    }
    break;
  }
  return login(account.login, PASSWORD);
}

const api =
  (base: string) =>
  <T = unknown>(token: string, path: string, method = "GET", body?: unknown) =>
    request<T>(`${base}${path}`, { method, token, body });
const ac = api(academicUrl);
const id = api(identityUrl);

/** Un PDF sencillo (texto en Helvetica), sin dependencias. */
function demoPdf(title: string, pages: Array<{ heading: string; lines: string[] }>): Buffer {
  const text = (s: string) => `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) + 1;
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  const pagesId = objects.length + 2 + pages.length * 2;
  pages.forEach((page, i) => {
    const body = [
      "0.043 0.541 0.42 rg 0 732 612 60 re f",
      `BT /F2 20 Tf 1 1 1 rg 40 755 Td ${text(title)} Tj ET`,
      `BT /F2 16 Tf 0.02 0.24 0.19 rg 40 690 Td ${text(page.heading)} Tj ET`,
      `BT /F1 12 Tf 0.1 0.1 0.1 rg 40 660 Td 20 TL ${page.lines.map((l) => `${text(l)} Tj T*`).join(" ")} ET`,
      `BT /F1 10 Tf 0.4 0.4 0.4 rg 280 40 Td ${text(`Página ${i + 1} de ${pages.length}`)} Tj ET`,
    ].join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R ` +
          `/Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> >>`,
      ),
    );
  });
  add(`<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  const all = [`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, ...objects];
  all.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${all.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${all.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/** Sube un archivo como lo hace el panel (el cuerpo es el archivo; los datos, en la dirección). */
async function upload(token: string, path: string, file: Buffer, name: string) {
  const res = await fetch(`${academicUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/pdf",
      "content-length": String(file.length),
      "x-file-name": encodeURIComponent(name),
    },
    body: new Uint8Array(file),
  });
  if (!res.ok) throw new Error(`subir ${name} -> ${res.status}: ${await res.text()}`);
}

const FRACTIONS_GUIDE = demoPdf("Guía de fracciones · 7.º grado", [
  {
    heading: "Fracciones equivalentes",
    lines: [
      "Dos fracciones son equivalentes cuando representan la misma parte de un entero.",
      "Para encontrar una fracción equivalente, multiplica o divide el numerador y el",
      "denominador por el mismo número.",
      "",
      "Ejemplo: 1/2 = 2/4 = 4/8 (multiplicamos por 2 cada vez).",
      "Ejemplo: 6/9 = 2/3 (dividimos entre 3).",
    ],
  },
  {
    heading: "Ejercicios",
    lines: [
      "1. Escribe dos fracciones equivalentes a 3/5.",
      "2. Simplifica 8/12.",
      "3. ¿Es 4/6 equivalente a 2/3? Explica por qué.",
      "4. Completa: 5/7 = ?/21",
      "5. Ordena de menor a mayor: 1/2, 3/8, 5/6.",
    ],
  },
]);

// ───────────────────────────── Alumnos ─────────────────────────────

const MOM_ID = "0801198512345";
const SEVENTH: Array<[string, string, string]> = [
  [CENTRO_DEMO.student.firstNames, CENTRO_DEMO.student.lastNames, "0801201300101"],
  ["Diego Alejandro", "Martínez Flores", "0801201300102"],
  ["Sofía Isabel", "Hernández Cruz", "0801201300103"],
  ["Carlos Eduardo", "López Mejía", "0801201300104"],
  ["Gabriela", "Rodríguez Zelaya", "0801201300105"],
  ["José Manuel", "Pineda Castro", "0801201300106"],
  ["María Fernanda", "Aguilar Reyes", "0801201300107"],
  ["Luis Fernando", "Ramos Sánchez", "0801201300108"],
  ["Daniela", "Ortiz Villeda", "0801201300109"],
  ["Kevin Josué", "Banegas Rivera", "0801201300110"],
  ["Andrea Lucía", "Mendoza Paz", "0801201300111"],
  ["Fernando José", "Cáceres Molina", "0801201300112"],
];
const FIRST: Array<[string, string, string]> = [
  ["Mateo", "Gómez Rivera", "0801201900201"],
  ["Camila", "Flores Ávila", "0801201900202"],
  ["Santiago", "Murillo Díaz", "0801201900203"],
  ["Valentina", "Suazo Cálix", "0801201900204"],
  ["Emiliano", "Matute Lagos", "0801201900205"],
  ["Isabella", "Velásquez Ponce", "0801201900206"],
  ["Thiago", "Bonilla Fúnez", "0801201900207"],
  ["Abigail", "Enamorado Sierra", "0801201900208"],
];

/** Un id que siempre sale igual para la misma clave (así, volver a correr no duplica actividades). */
function stableId(key: string): string {
  const h = createHash("sha256").update(`centro-demo:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const ANNOUNCEMENT = "Reunión de padres de familia";

async function main() {
  console.log(`Cargando «${CENTRO_DEMO.name}»…`);
  // La misma regla de las pantallas: si la contraseña no sirve, se avisa antes de tocar nada.
  const weak = passwordSchema.safeParse(PASSWORD);
  if (!weak.success) {
    throw new Error(`La contraseña de la demo (DEMO_PASSWORD) no sirve: ${weak.error.issues[0]?.message}`);
  }
  const [, , , [, , mathEmail], [, , spanishEmail], [, , primaryEmail]] = CENTRO_DEMO.staff;
  const director = await login(CENTRO_DEMO.staff[0][2], PASSWORD);

  const list = (sectionId: string) =>
    ac<{ items: StudentListItemDto[] }>(director, `/students?sectionId=${sectionId}&limit=100`).then(
      (r) => r.items,
    );

  /**
   * Cuentas de la alumna (con su correo), de tres compañeros de 7.º y de la familia, con la contraseña
   * de la demo. Se crean si faltan y siempre reciben la contraseña actual (por si cambió DEMO_PASSWORD).
   */
  async function accounts(seventhId: string, seventhStudents: StudentListItemDto[]) {
    const valeria = seventhStudents.find((s) => s.firstNames === CENTRO_DEMO.student.firstNames);
    if (!valeria) throw new Error("No se encontró a la alumna de la demo");
    const secretary = await login(CENTRO_DEMO.staff[2][2], PASSWORD);
    const studentToken = async (studentId: string, email?: string) => {
      const detail = await ac<StudentDetailDto>(director, `/students/${studentId}`);
      if (!detail.hasStudentAccess) {
        await ac(secretary, `/students/${studentId}/student-access`, "POST", email ? { email } : {});
      }
      // Una contraseña temporal nueva (aunque ya tuviera cuenta), que enseguida pasa a la de la demo.
      return settle(
        await ac<FamilyAccountDto>(secretary, `/students/${studentId}/student-access/reset`, "POST"),
      );
    };
    const valeriaToken = await studentToken(valeria.id, CENTRO_DEMO.student.email);
    await ac<SectionStudentAccessDto>(secretary, `/sections/${seventhId}/student-access`, "POST");
    const classmates: Record<string, string> = {};
    for (const name of ["Diego Alejandro", "Sofía Isabel", "Carlos Eduardo"]) {
      const student = seventhStudents.find((s) => s.firstNames === name);
      if (student) classmates[name] = await studentToken(student.id);
    }
    const valeriaDetail = await ac<StudentDetailDto>(director, `/students/${valeria.id}`);
    const mom = valeriaDetail.guardians.find((g) => g.fullName === CENTRO_DEMO.family.name);
    if (!mom) throw new Error("No se encontró a la madre de la demo");
    if (!mom.hasPortalAccess) {
      await ac(secretary, `/guardians/${mom.id}/portal-access`, "POST", { email: CENTRO_DEMO.family.email });
    }
    await settle(await ac<FamilyAccountDto>(secretary, `/guardians/${mom.id}/portal-access/reset`, "POST"));
    return { valeriaToken, classmates };
  }

  // El aviso a las familias es lo último que se carga: si ya está, el centro está completo y solo se
  // ponen al día las contraseñas de la alumna y la familia.
  const announcements = await ac<AnnouncementDto[]>(director, "/announcements");
  if (announcements.some((a) => a.title === ANNOUNCEMENT)) {
    const seventh = (await ac<SectionDto[]>(director, "/sections")).find(
      (s) => s.gradeName === "Séptimo grado" && s.name === "A",
    );
    if (seventh) await accounts(seventh.id, await list(seventh.id));
    console.log("El centro de demostración ya está cargado: solo se pusieron al día las contraseñas.");
    return;
  }
  // Si una carga anterior se quedó a medias, cada paso revisa lo que ya existe y sigue desde ahí.

  // ── Año lectivo y parciales: hoy va en el IV parcial, que cierra en dos meses ──
  const years = await ac<SchoolYearDto[]>(director, "/school-years");
  const year =
    years[0] ??
    (await ac<SchoolYearDto>(director, "/school-years", "POST", {
      name: today.slice(0, 4),
      startsOn: addDays(today, -235),
      endsOn: addDays(today, 60),
    }));
  const span = (name: string, from: number, to: number, close: number) => ({
    name,
    startsOn: addDays(today, from),
    endsOn: addDays(today, to),
    closesOn: addDays(today, close),
  });
  const periods = await ac<Array<{ id: string; number: number }>>(director, "/periods", "PUT", {
    periods: [
      span("I Parcial", -235, -176, -170),
      span("II Parcial", -175, -116, -110),
      span("III Parcial", -115, -56, -50),
      span("IV Parcial", -55, 58, 60),
    ],
  });
  const periodId = (n: number) => periods.find((p) => p.number === n)?.id as string;

  const subjects = await ac<SubjectDto[]>(director, "/subjects");
  const subjectIds: Record<string, string> = {};
  for (const name of ["Matemáticas", "Español", "Ciencias Naturales", "Ciencias Sociales", "Inglés"]) {
    subjectIds[name] =
      subjects.find((x) => x.name === name)?.id ??
      (
        await ac<SubjectDto>(director, "/subjects", "POST", {
          name,
          ...(name === "Inglés" ? { language: "en" } : {}),
        })
      ).id;
  }
  const gradeList = await ac<GradeDto[]>(director, "/grades");
  const sectionList = await ac<SectionDto[]>(director, "/sections");
  const section = async (gradeName: string, sortOrder: number) => {
    const grade =
      gradeList.find((g) => g.name === gradeName) ??
      (await ac<GradeDto>(director, "/grades", "POST", { name: gradeName, sortOrder }));
    const existing = sectionList.find(
      (x) => x.schoolYearId === year.id && x.gradeId === grade.id && x.name === "A",
    );
    return (
      existing ??
      (await ac<SectionDto>(director, "/sections", "POST", {
        schoolYearId: year.id,
        gradeId: grade.id,
        name: "A",
        capacity: 30,
      }))
    );
  };
  const first = await section("Primer grado", 1);
  const seventh = await section("Séptimo grado", 7);

  // ── Quién da qué ──
  const staff = await id<UserDto[]>(director, "/users");
  const userId = (email: string) => {
    const user = staff.find((u) => u.email === email);
    if (!user)
      throw new Error(`Falta la cuenta ${email}: corre primero el seed de identity (SEED_CENTRO_DEMO)`);
    return user.id;
  };
  const assignments = await ac<AssignmentDto[]>(director, "/assignments");
  const assign = async (sectionId: string, subject: string, email: string): Promise<{ id: string }> =>
    assignments.find((a) => a.sectionId === sectionId && a.subjectId === subjectIds[subject]) ??
    (await ac<AssignmentDto>(director, "/assignments", "POST", {
      sectionId,
      subjectId: subjectIds[subject],
      teacherUserId: userId(email),
    }));
  const math7 = await assign(seventh.id, "Matemáticas", mathEmail);
  const science7 = await assign(seventh.id, "Ciencias Naturales", mathEmail);
  const spanish7 = await assign(seventh.id, "Español", spanishEmail);
  const social7 = await assign(seventh.id, "Ciencias Sociales", spanishEmail);
  const english7 = await assign(seventh.id, "Inglés", spanishEmail);
  const firstClasses: Record<string, { id: string }> = {};
  for (const subject of Object.keys(subjectIds))
    firstClasses[subject] = await assign(first.id, subject, primaryEmail);
  console.log("  ✓ año, parciales, grados, materias y maestros");

  // ── Alumnos y familias ──
  if ((await list(seventh.id)).length === 0 && (await list(first.id)).length === 0) {
    const rows = [
      ...SEVENTH.map(([nombres, apellidos, identidad]) => ({
        nombres,
        apellidos,
        identidad,
        grado: "Séptimo grado",
      })),
      ...FIRST.map(([nombres, apellidos, identidad]) => ({
        nombres,
        apellidos,
        identidad,
        grado: "Primer grado",
      })),
    ].map((r) => {
      const gomez = r.apellidos === CENTRO_DEMO.student.lastNames;
      return {
        ...r,
        seccion: "A",
        responsable: gomez
          ? CENTRO_DEMO.family.name
          : `${["Carmen", "Rosa", "Marta", "José", "Juan"][rand(5)]} ${r.apellidos.split(" ")[0]}`,
        parentesco: gomez ? "madre" : ["madre", "padre", "abuelo", "tutor"][rand(4)],
        ...(gomez ? { identidad_responsable: MOM_ID, correo: CENTRO_DEMO.family.email } : {}),
        telefono: `9${String(1000000 + rand(8999999)).slice(0, 7)}`,
      };
    });
    await ac(director, "/students/import", "POST", { rows, dryRun: false });
  }
  const seventhStudents = await list(seventh.id);
  console.log("  ✓ alumnos en Primer grado A y Séptimo grado A");

  const { valeriaToken, classmates } = await accounts(seventh.id, seventhStudents);
  console.log("  ✓ cuentas del aula virtual (alumna y 7.º grado) y de la familia");

  // ── Asistencia de las últimas tres semanas (guardarla otra vez solo la reemplaza) ──
  const schoolDays: string[] = [];
  for (let d = -21; d <= 0; d++) {
    const date = addDays(today, d);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) schoolDays.push(date);
  }
  for (const sectionId of [first.id, seventh.id]) {
    const roster = (await ac<AttendanceSheetDto>(director, `/attendance/${sectionId}?fecha=${schoolDays[0]}`))
      .students;
    for (const date of schoolDays) {
      await ac(director, "/attendance", "PUT", {
        sectionId,
        date,
        entries: roster.map((r) => {
          const roll = rand(100);
          const status: AttendanceStatus =
            roll < 4 ? "ausente" : roll < 8 ? "tarde" : roll < 10 ? "justificada" : "presente";
          return { studentId: r.studentId, status };
        }),
      });
    }
  }
  console.log("  ✓ asistencia de las últimas tres semanas");

  // ── Notas: los parciales I a III completos y el IV a medias (el resto lo ponen tareas y exámenes) ──
  const ability = new Map<string, number>();
  const level = (studentId: string) => {
    if (!ability.has(studentId))
      ability.set(studentId, rand(10) === 0 ? 0.5 + rand(15) / 100 : 0.74 + rand(24) / 100);
    return ability.get(studentId) as number;
  };
  const grade = async (
    assignmentId: string,
    sectionId: string,
    plan: Array<[number, string, number, number]>,
  ) => {
    const roster = (await ac<AttendanceSheetDto>(director, `/attendance/${sectionId}?fecha=${today}`))
      .students;
    for (const [period, name, maxPoints, day] of plan) {
      // El mismo id cada vez: guardarla otra vez actualiza la actividad en vez de crear otra.
      const activityId = stableId(`${assignmentId}:${period}:${name}`);
      await ac(director, `/activities/${activityId}`, "PUT", {
        id: activityId,
        assignmentId,
        periodId: periodId(period),
        name,
        maxPoints,
        date: addDays(today, day),
      });
      await ac(director, "/scores", "PUT", {
        activityId,
        entries: roster.map((r) => {
          const ratio = Math.max(0, Math.min(1, level(r.studentId) + (rand(13) - 6) / 100));
          return { studentId: r.studentId, points: Math.round(ratio * maxPoints * 2) / 2 };
        }),
      });
    }
  };
  const fullYear: Array<[number, string, number, number]> = [
    [1, "Trabajos del parcial", 50, -200],
    [1, "Examen del parcial", 50, -180],
    [2, "Trabajos del parcial", 50, -140],
    [2, "Examen del parcial", 50, -120],
    [3, "Trabajos del parcial", 50, -80],
    [3, "Examen del parcial", 50, -60],
    [4, "Trabajo en clase", 20, -40],
    [4, "Prueba corta", 20, -20],
  ];
  for (const a of [math7, science7, spanish7, social7, english7]) await grade(a.id, seventh.id, fullYear);
  for (const a of Object.values(firstClasses)) await grade(a.id, first.id, fullYear);
  console.log("  ✓ notas de los cuatro parciales");

  // ── Biblioteca ──
  const guideTitle = "Guía de fracciones · 7.º grado";
  const library = await ac<LibraryItemDto[]>(director, "/library");
  if (!library.some((item) => item.title === guideTitle)) {
    const libraryQuery = new URLSearchParams({ titulo: guideTitle, para: "familias" });
    const seventhGrade = (await ac<GradeDto[]>(director, "/grades")).find((g) => g.name === "Séptimo grado");
    if (seventhGrade) libraryQuery.set("grado", seventhGrade.id);
    libraryQuery.set("materia", subjectIds.Matemáticas as string);
    await upload(director, `/library/files?${libraryQuery}`, FRACTIONS_GUIDE, "Guía de fracciones 7.º.pdf");
  }

  // ── Aula virtual: lo que ya está publicado no se repite ──
  const roomOf = (token: string, classId: string) => ac<ClassroomDto>(token, `/classes/${classId}`);
  const ensurePost = async (
    token: string,
    classId: string,
    kind: "tema" | "aviso",
    title: string,
    body: string,
  ) => {
    const room = await roomOf(token, classId);
    const existing = [...room.topics, ...room.announcements].find(
      (p) => p.kind === kind && p.title === title,
    );
    return existing ?? ac<ClassPostDto>(token, `/classes/${classId}/posts`, "POST", { kind, title, body });
  };
  const ensureLink = async (token: string, post: ClassPostDto, title: string, url: string) => {
    if (!post.materials.some((m) => m.title === title)) {
      await ac(token, `/class-posts/${post.id}/links`, "POST", { title, url });
    }
  };
  const ensureTask = async (
    token: string,
    classId: string,
    input: { title: string } & Record<string, unknown>,
  ) => {
    const room = await roomOf(token, classId);
    return (
      room.tasks.find((t) => t.title === input.title) ??
      ac<ClassTaskDto>(token, `/classes/${classId}/tasks`, "POST", input)
    );
  };
  /** Entrega la tarea a nombre del alumno, si todavía no la entregó. */
  const turnIn = async (token: string, taskId: string, text: string) => {
    const detail = await ac<ClassTaskDetailDto>(token, `/class-tasks/${taskId}`);
    if (detail.canSubmit && !detail.mine?.submittedAt) {
      await ac(token, `/class-tasks/${taskId}/submission`, "PUT", { text, turnIn: true });
    }
  };

  // Matemáticas de 7.º
  const lucia = await login(mathEmail, PASSWORD);
  await ac(lucia, `/classes/${math7.id}/settings`, "PUT", {
    meetingUrl: "https://meet.jit.si/ConectaDemoMatematicas7A",
    meetingNote: "Martes y jueves, 2:00 p. m.",
  });
  await ensurePost(
    lucia,
    math7.id,
    "aviso",
    "¡Bienvenidos al aula virtual de Matemáticas!",
    "Aquí van a encontrar los temas, las guías, las tareas y los exámenes. Si tienen dudas, pregúntenme en clase.",
  );
  const decimals = await ensurePost(
    lucia,
    math7.id,
    "tema",
    "Unidad 2: Números decimales",
    "Los números decimales tienen una parte entera y una parte decimal separadas por un punto.\n\nEjemplo: en 3.25, el 3 es la parte entera y el 25 son centésimos.",
  );
  await ensureLink(
    lucia,
    decimals,
    "Práctica de decimales en Khan Academy",
    "https://es.khanacademy.org/math/arithmetic-home/arith-review-decimals",
  );
  const fractions = await ensurePost(
    lucia,
    math7.id,
    "tema",
    "Unidad 3: Fracciones equivalentes",
    "Dos fracciones son equivalentes cuando representan la misma parte de un entero. Para encontrarlas, multiplicamos o dividimos el numerador y el denominador por el mismo número.\n\nEjemplo: 1/2 = 2/4 = 4/8.\n\nRevisa la guía y resuelve los ejercicios antes de la próxima clase.",
  );
  if (!fractions.materials.some((m) => m.kind === "archivo")) {
    await upload(lucia, `/class-posts/${fractions.id}/files`, FRACTIONS_GUIDE, "Guía de fracciones.pdf");
  }
  await ensureLink(
    lucia,
    fractions,
    "Fracciones equivalentes en Khan Academy",
    "https://es.khanacademy.org/math/arithmetic/fraction-arithmetic",
  );
  await ensurePost(
    lucia,
    math7.id,
    "aviso",
    "El jueves repasamos fracciones",
    "Traigan la guía resuelta. El examen en línea de fracciones ya está abierto.",
  );

  // Tarea ya calificada (venció hace 3 días)
  const graded = await ensureTask(lucia, math7.id, {
    title: "Ejercicios de fracciones equivalentes",
    instructions:
      "Resuelve los ejercicios 1 al 5 de la guía en tu cuaderno y sube una foto clara, o escribe tus respuestas.",
    dueDate: addDays(today, -3),
    dueTime: "23:59",
    allowLate: true,
    points: 10,
    periodId: periodId(4),
  });
  const answers: Record<string, string> = {
    [CENTRO_DEMO.student.firstNames]:
      "1) 6/10 y 9/15  2) 2/3  3) Sí, porque 4/6 dividido entre 2 es 2/3  4) 15  5) 3/8, 1/2, 5/6",
    "Diego Alejandro": "1) 6/10 y 12/20  2) 2/3  3) Sí  4) 15  5) 1/2, 3/8, 5/6",
    "Sofía Isabel": "1) 6/10 y 9/15  2) 4/6  3) Sí, son iguales  4) 15  5) 3/8, 1/2, 5/6",
  };
  const tokenOf = (name: string) =>
    name === CENTRO_DEMO.student.firstNames ? valeriaToken : classmates[name];
  for (const [name, text] of Object.entries(answers)) {
    const token = tokenOf(name);
    if (token) await turnIn(token, graded.id, text);
  }
  const feedback: Record<string, [number, string]> = {
    [CENTRO_DEMO.student.firstNames]: [10, "¡Excelente! Todo correcto y bien explicado."],
    "Diego Alejandro": [8, "Muy bien. Revisa el orden del ejercicio 5."],
    "Sofía Isabel": [8.5, "Bien. En el 2 faltó simplificar hasta 2/3."],
  };
  for (const [name, [points, comment]] of Object.entries(feedback)) {
    const student = seventhStudents.find((s) => s.firstNames === name);
    if (student)
      await ac(lucia, `/class-tasks/${graded.id}/grades/${student.id}`, "PUT", { points, feedback: comment });
  }
  // Tarea abierta (vence en 5 días): Diego ya entregó; Valeria todavía no.
  const open = await ensureTask(lucia, math7.id, {
    title: "Problemas con números decimales",
    instructions:
      "Resuelve los problemas de la página 52 (1 al 6). Puedes subir una foto de tu cuaderno o un documento.",
    dueDate: addDays(today, 5),
    dueTime: "18:00",
    allowLate: false,
    points: 10,
    periodId: periodId(4),
  });
  if (classmates["Diego Alejandro"]) {
    await turnIn(
      classmates["Diego Alejandro"],
      open.id,
      "1) 4.75  2) 12.3  3) 0.85  4) 7.2  5) 15.05  6) 3.4",
    );
  }

  // Examen abierto por dos semanas, 20 minutos: Diego y Sofía ya lo presentaron.
  const quizTitle = "Prueba corta: fracciones equivalentes";
  const quiz =
    (await roomOf(lucia, math7.id)).quizzes.find((q) => q.title === quizTitle) ??
    (await ac<ClassQuizDto>(lucia, `/classes/${math7.id}/quizzes`, "POST", {
      title: quizTitle,
      instructions: "Tienes 20 minutos. Lee bien cada pregunta antes de responder.",
      opensDate: addDays(today, -1),
      opensTime: "07:00",
      closesDate: addDays(today, 14),
      closesTime: "23:59",
      timeLimitMinutes: 20,
      shuffle: false,
      points: 10,
      periodId: periodId(4),
    }));
  const questionInputs = [
    {
      kind: "opcion",
      prompt: "¿Cuál fracción es equivalente a 1/2?",
      options: ["1/3", "2/4", "3/5", "2/3"],
      correct: 1,
      points: 3,
    },
    {
      kind: "opcion",
      prompt: "Simplifica 6/9.",
      options: ["2/3", "3/6", "1/3", "6/3"],
      correct: 0,
      points: 3,
    },
    { kind: "vf", prompt: "4/8 y 1/2 son fracciones equivalentes.", correct: true, points: 2 },
    {
      kind: "abierta",
      prompt: "Explica con tus palabras cómo encuentras una fracción equivalente.",
      points: 2,
    },
  ];
  const have = (await ac<ClassQuizDetailDto>(lucia, `/class-quizzes/${quiz.id}`)).questions;
  const questions: QuizQuestionDto[] = [];
  for (const input of questionInputs) {
    questions.push(
      have.find((q) => q.prompt === input.prompt) ??
        (await ac<QuizQuestionDto>(lucia, `/class-quizzes/${quiz.id}/questions`, "POST", input)),
    );
  }
  const [q1, q2, q3, q4] = questions as [QuizQuestionDto, QuizQuestionDto, QuizQuestionDto, QuizQuestionDto];
  await ac(lucia, `/class-quizzes/${quiz.id}/publish`, "POST", { published: true });
  const takers: Array<[string, Record<string, number | boolean | string>]> = [
    [
      "Diego Alejandro",
      { [q1.id]: 1, [q2.id]: 0, [q3.id]: true, [q4.id]: "Multiplico arriba y abajo por el mismo número." },
    ],
    [
      "Sofía Isabel",
      {
        [q1.id]: 1,
        [q2.id]: 1,
        [q3.id]: true,
        [q4.id]: "Divido el numerador y el denominador entre el mismo número.",
      },
    ],
  ];
  for (const [name, given] of takers) {
    const token = classmates[name];
    if (!token) continue;
    const status = (await ac<ClassQuizDetailDto>(token, `/class-quizzes/${quiz.id}`)).mine?.status;
    if (status === "disponible") await ac(token, `/class-quizzes/${quiz.id}/start`, "POST");
    if (status === "disponible" || status === "en_curso") {
      await ac(token, `/class-quizzes/${quiz.id}/answers`, "PUT", { answers: given, finish: true });
    }
  }
  const diego = seventhStudents.find((s) => s.firstNames === "Diego Alejandro");
  if (diego) {
    await ac(lucia, `/class-quizzes/${quiz.id}/attempts/${diego.id}/review`, "PUT", {
      points: { [q4.id]: 2 },
    });
  }

  await ensurePost(
    lucia,
    science7.id,
    "tema",
    "Unidad 4: El sistema solar",
    "El sistema solar está formado por el Sol y los cuerpos que giran a su alrededor: ocho planetas, sus lunas, asteroides y cometas.",
  );
  console.log("  ✓ aula virtual de Matemáticas: temas, guía, avisos, clase en línea, tareas y examen");

  // ── Español de 7.º y Primer grado ──
  const andres = await login(spanishEmail, PASSWORD);
  await ensurePost(
    andres,
    spanish7.id,
    "tema",
    "Lectura: cuentos de autores hondureños",
    "Esta semana leemos «El cuento del Cadejo». Fíjate en los personajes, el lugar y el mensaje del cuento.",
  );
  await ensureTask(andres, spanish7.id, {
    title: "Resumen del cuento",
    instructions: "Escribe un resumen de media página: personajes, lugar, qué pasa y qué mensaje deja.",
    dueDate: addDays(today, 7),
    dueTime: "23:59",
    allowLate: true,
  });
  const rosa = await login(primaryEmail, PASSWORD);
  const sums = firstClasses.Matemáticas as { id: string };
  await ensurePost(
    rosa,
    sums.id,
    "tema",
    "Sumas hasta 20",
    "Practicamos sumas con objetos de la casa: frijoles, tapitas o palitos. Papás: acompáñenlos y anímenlos.",
  );
  await ensureTask(rosa, sums.id, {
    title: "Sumas con tapitas",
    instructions: "Con ayuda de un adulto, resuelvan 10 sumas usando tapitas. Suban una foto del cuaderno.",
    dueDate: addDays(today, 4),
    dueTime: "23:59",
    allowLate: true,
  });
  console.log("  ✓ aula virtual de Español y de Primer grado");

  // ── Al final, el aviso del centro para las familias (y marca que la carga terminó) ──
  await ac(director, "/announcements", "POST", {
    title: ANNOUNCEMENT,
    body: "Los esperamos el próximo viernes a las 5:00 p. m. para entregar las notas del IV parcial.",
    audience: "todos",
  });
  console.log("Listo.");
}

await main();

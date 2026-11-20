#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: script manual, fuera de las tareas de turbo; se configura con variables al correrlo.
/**
 * Prueba de carga del «cierre de parcial»: muchos maestros a la vez abriendo su cuaderno, guardando
 * notas y pasando asistencia, y la dirección revisando el seguimiento. Habla directo con los servicios
 * (identity y academic), que es donde está la base de datos.
 *
 * Uso (con la demo cargada y los servicios corriendo):
 *
 *   psql "$IDENTITY_DB" -At -c "select u.email from users u join memberships m on m.user_id = u.id
 *     where m.role = 'docente' and u.email is not null" > /tmp/maestros.txt
 *   CUENTAS=/tmp/maestros.txt USUARIOS=100 DURACION=60 node scripts/prueba-de-carga.mjs
 *
 * Variables:
 *   CUENTAS            archivo con un correo de maestro por línea (obligatorio)
 *   CUENTAS_DIRECCION  archivo con correos de la dirección (opcional): consultan el seguimiento
 *   CLAVE              contraseña de las cuentas (por defecto la de la demo)
 *   USUARIOS           maestros conectados a la vez (por defecto 50)
 *   DURACION           segundos de prueba (por defecto 30)
 *   PAUSA_MS           pausa promedio entre acciones de cada maestro (por defecto 300)
 *   IDENTITY_URL, ACADEMIC_URL
 *
 * ¡Escribe notas y asistencia de verdad! Úsala solo con la demo o un ambiente de pruebas.
 */
import { readFileSync } from "node:fs";

const IDENTITY = process.env.IDENTITY_URL ?? "http://localhost:3001";
const ACADEMIC = process.env.ACADEMIC_URL ?? "http://localhost:3002";
const PASSWORD = process.env.CLAVE ?? "Demo-colegio-2026";
const USERS = Number(process.env.USUARIOS ?? 50);
const SECONDS = Number(process.env.DURACION ?? 30);
const PAUSE = Number(process.env.PAUSA_MS ?? 300);

const lines = (path) =>
  path
    ? readFileSync(path, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];
const teachers = lines(process.env.CUENTAS);
const directors = lines(process.env.CUENTAS_DIRECCION);
if (teachers.length === 0) {
  console.error(
    "Falta CUENTAS: un archivo con un correo de maestro por línea (ver el comentario del script).",
  );
  process.exit(1);
}

const stats = new Map();
const errorTimes = [];
function track(name, ms, ok, status) {
  if (!ok) errorTimes.push(Date.now());
  let s = stats.get(name);
  if (!s) {
    s = { times: [], errors: 0, statuses: new Map() };
    stats.set(name, s);
  }
  s.times.push(ms);
  if (!ok) {
    s.errors++;
    s.statuses.set(status, (s.statuses.get(status) ?? 0) + 1);
  }
}

async function call(name, url, { token, method = "GET", body } = {}) {
  const started = performance.now();
  let status = 0;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    status = res.status;
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    track(name, performance.now() - started, res.ok, status);
    return res.ok ? data : null;
  } catch (err) {
    track(name, performance.now() - started, false, err?.name === "TimeoutError" ? "tiempo" : "red");
    return null;
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const pause = () => sleep(PAUSE * (0.5 + Math.random()));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

async function login(email) {
  const result = await call("inicio de sesión", `${IDENTITY}/auth/login`, {
    method: "POST",
    body: { email, password: PASSWORD },
  });
  return result?.accessToken ?? null;
}

// ─── Lo que hace un maestro durante el cierre ───
async function teacher(token, deadline) {
  const today = new Date().toISOString().slice(0, 10);
  while (Date.now() < deadline) {
    const classes = await call("abrir el cuaderno", `${ACADEMIC}/teacher/classes`, { token });
    if (!classes?.length) {
      // Como un maestro de verdad: si no cargó, espera un momento y vuelve a intentar.
      await sleep(1000);
      continue;
    }
    const { assignment } = pick(classes);
    await pause();

    const book = await call("ver la libreta de notas", `${ACADEMIC}/gradebook/${assignment.id}`, { token });
    await pause();
    if (book?.canEdit && book.activities.length && book.students.length) {
      const activity = pick(book.activities);
      await call("guardar notas", `${ACADEMIC}/scores`, {
        token,
        method: "PUT",
        body: {
          activityId: activity.id,
          entries: book.students.map((s) => ({
            studentId: s.studentId,
            points: Math.round(Math.random() * activity.maxPoints * 2) / 2,
          })),
        },
      });
      await pause();
    }

    const sheet = await call("ver la asistencia", `${ACADEMIC}/attendance/${assignment.sectionId}`, {
      token,
    });
    await pause();
    if (sheet?.canEdit && sheet.students.length) {
      await call("pasar asistencia", `${ACADEMIC}/attendance`, {
        token,
        method: "PUT",
        body: {
          sectionId: assignment.sectionId,
          date: sheet.date ?? today,
          entries: sheet.students.map((s) => ({
            studentId: s.studentId,
            status: Math.random() < 0.9 ? "presente" : "ausente",
          })),
        },
      });
      await pause();
    }
  }
}

// ─── La dirección revisando cómo va el cierre ───
async function director(token, deadline) {
  while (Date.now() < deadline) {
    await call("seguimiento de la dirección", `${ACADEMIC}/follow-up`, { token });
    await sleep(PAUSE * 5 * (0.5 + Math.random()));
  }
}

const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
const ms = (v) => `${Math.round(v)} ms`.padStart(8);

console.log(
  `Iniciando sesión con ${teachers.length} maestros${directors.length ? ` y ${directors.length} de la dirección` : ""}…`,
);
const teacherTokens = (await Promise.all(teachers.map(login))).filter(Boolean);
const directorTokens = (await Promise.all(directors.map(login))).filter(Boolean);
if (teacherTokens.length === 0) {
  console.error("Ningún maestro pudo iniciar sesión. ¿Están corriendo los servicios y la demo?");
  process.exit(1);
}
stats.clear();

console.log(`${USERS} maestros conectados a la vez durante ${SECONDS} s (pausa promedio ${PAUSE} ms)…`);
const started = Date.now();
const deadline = started + SECONDS * 1000;
await Promise.all([
  ...Array.from({ length: USERS }, (_, i) => teacher(teacherTokens[i % teacherTokens.length], deadline)),
  ...directorTokens.map((t) => director(t, deadline)),
]);
const elapsed = (Date.now() - started) / 1000;

let total = 0;
let errors = 0;
console.log(
  `\n${"Acción".padEnd(30)}${"veces".padStart(7)}${"errores".padStart(9)}  mediana      p95      p99   máximo`,
);
for (const [name, s] of stats) {
  const sorted = [...s.times].sort((a, b) => a - b);
  total += sorted.length;
  errors += s.errors;
  const detail = s.errors ? `  (${[...s.statuses].map(([k, v]) => `${k}: ${v}`).join(", ")})` : "";
  console.log(
    `${name.padEnd(30)}${String(sorted.length).padStart(7)}${String(s.errors).padStart(9)} ${ms(percentile(sorted, 50))} ${ms(percentile(sorted, 95))} ${ms(percentile(sorted, 99))} ${ms(sorted.at(-1) ?? 0)}${detail}`,
  );
}
console.log(
  `\nTotal: ${total} peticiones en ${elapsed.toFixed(0)} s (${(total / elapsed).toFixed(0)} por segundo), ${errors} con error (${((errors / Math.max(total, 1)) * 100).toFixed(2)} %).`,
);
if (errorTimes.length) {
  const at = (t) => ((t - started) / 1000).toFixed(1);
  console.log(
    `Los errores ocurrieron entre el segundo ${at(errorTimes[0])} y el ${at(errorTimes.at(-1))} de la prueba; después de eso, todo respondió bien.`,
  );
}
process.exit(errors > 0 ? 2 : 0);

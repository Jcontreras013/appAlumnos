# CONECTA

**C**omunicación, **O**rientación, **N**otas, **E**valuación, **C**alendario, **T**areas y
**A**sistencia: maestros y familias, conectados. Para escuelas públicas y privadas.

Plataforma para centros educativos de Honduras, pensada para presentarse a una **Dirección
Departamental de Educación**:

- La **dirección departamental** (y la distrital) ve en un tablero cómo van todos sus centros:
  alumnos, maestros, licencias y, sobre todo, **clases que se quedaron sin maestro**.
- Cada **dirección de escuela** entra con el logo de su centro, gestiona alumnos y maestros y, cuando
  alguien sale de vacaciones o se enferma, **asigna sustitutos** a sus clases.
- Los **maestros** tienen una sola cuenta aunque trabajen en dos escuelas (matutina y vespertina),
  y llevan su **cuaderno** (asistencia diaria y notas por actividad) desde el teléfono, **aun sin
  internet**. Al cierre del parcial, las notas quedan listas para pasarlas al **SACE**.
- Cada semana el maestro entrega su **planificación** por clase; la dirección o coordinación la
  aprueba o la devuelve con observaciones, y la departamental ve qué centros van al día.
- Las **familias** entran con su número de identidad (o su correo) y ven las notas, la asistencia y
  las tareas de la semana de sus hijos, y su boleta para imprimir.
- Cada centro publica **avisos** (a familias o al personal), arma el **horario** de cada sección,
  registra el **seguimiento** de los alumnos en riesgo, emite **constancias** y hace **traslados** a
  otro centro del departamento, que recibe al alumno con su historial.
- Al terminar el año, cada clase tiene su **nota final** y la **recuperación** de quien no alcanzó la
  nota mínima; la dirección revisa y **pasa a todos al año siguiente** (promovidos, repiten o
  egresan) en un solo paso.

Para colegios privados quedan además facturación (con CAI) y wallet de cafetería.

> El nombre se cambia en `apps/web/src/lib/brand.ts` (por ejemplo, si un ministerio lo adopta con su propio nombre).

## Estado

| Fase | Contenido                                                                                                   | Estado   |
| ---- | ----------------------------------------------------------------------------------------------------------- | -------- |
| 0    | Monorepo, CI, login, colegios (multi-tenant), usuarios y roles, infraestructura en AWS                      | ✅ Listo |
| 1    | Matrícula: estructura académica, alumnos, familias, cupos, importación desde Excel                          | ✅ Listo |
| 2    | Departamento → distrito → centro, maestros en varios centros, licencias y sustitutos, tablero departamental | ✅ Listo |
| 3    | Cuaderno del maestro sin internet (asistencia y notas por actividad), alerta temprana, cuadro para el SACE  | ✅ Listo |
| 4    | Planificación semanal con la plantilla del centro, revisión de dirección/coordinación e historial           | ✅ Listo |
| 5    | Portal de familias: notas, asistencia y tareas de sus hijos; acceso con identidad; boleta imprimible        | ✅ Listo |
| 6    | Piloto: corregir datos sin perder notas, Excel, indicadores del piloto, verificación en dos pasos (2FA)     | ✅ Listo |
| 7    | Escuela: avisos, horario, seguimiento, traslados, constancias, bitácora; nota final, recuperación, cierre   | ✅ Listo |
| 8    | Mensajes entre maestros y dirección (tipo chat), con «visto» y avisos al celular en horario de atención     | ✅ Listo |
| —    | Para colegios privados: facturación con CAI y wallet de cafetería                                           | Después  |

## Arquitectura

```mermaid
flowchart LR
  navegador([Navegador]) -->|HTTPS| alb[ALB]
  alb --> web["web<br/>Next.js 16 (BFF)"]
  web -->|Service Connect| identity["identity<br/>Fastify"]
  web -->|Service Connect| academic["academic<br/>Fastify"]
  academic -->|JWKS y validación de docentes| identity
  identity --> dbi[(escolar_identity)]
  academic --> dba[(escolar_academic)]
  futuros["billing · wallet<br/>(colegios privados)"] -. mismo patrón .-> identity
```

- **`apps/web`**: Next.js 16 (App Router). Funciona como _backend for frontend_: el navegador solo
  tiene cookies httpOnly, y es el servidor de Next el que llama a los microservicios.
- **`services/identity`**: colegios (tenants), usuarios, roles, login y emisión de tokens.
- **`services/academic`**: año lectivo, grados, secciones con cupo, materias, docentes por materia,
  alumnos, responsables (familias), matrícula, retiros, cambios de sección, importación desde Excel,
  licencias y sustitutos, parciales, actividades y notas, asistencia, seguimiento y tablero regional.
  No tiene la llave privada: verifica los tokens con el JWKS público de identity, y para validar a un
  docente consulta a identity reenviando el token de quien hace la petición.
- **`packages/service-kit`**: base común de todos los microservicios (servidor, errores, logs,
  verificación de tokens, configuración, conexión a Postgres y migraciones). Cada servicio crea su
  propia base de datos al arrancar si no existe.
- **`packages/shared`**: tipos, validaciones (Zod) y utilidades de dinero compartidas con el frontend.
- **`infra`**: AWS CDK (VPC, RDS, ECS Fargate con Service Connect, ALB).

Cada microservicio tiene **su propia base de datos** (mismo servidor Postgres en desarrollo, mismo
RDS en AWS) y nunca lee la base de otro: se comunican por API (y, desde facturación, por eventos).

## Complemento del SACE

Los maestros de escuelas públicas ya registran las notas oficiales en el **SACE** de la Secretaría de
Educación. Esta plataforma **no lo reemplaza ni entra en él** (nunca pide ni guarda contraseñas del
SACE): cubre lo que pasa _antes_ de que las notas lleguen ahí.

| En el SACE                                             | Aquí                                                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Se ingresa la nota final del parcial, al cierre        | El maestro registra cada actividad durante el parcial y la nota se calcula sola (100 puntos por parcial) |
| Necesita internet y computadora                        | Funciona en el teléfono y **sin internet**; se sincroniza solo cuando vuelve la señal                    |
| La asistencia diaria se lleva en papel                 | Lista de asistencia en un toque por alumno (presente, ausente, tarde, justificada)                       |
| Los problemas se ven cuando el parcial ya cerró        | **Alerta temprana**: alumnos en riesgo por faltas o por la proyección de sus notas, antes del cierre     |
| La dirección no sabe qué maestros van atrasados        | Avance de notas por clase y aviso cuando el cierre está a 7 días o menos                                 |
| La departamental ve los datos cuando ya son históricos | Tablero con asistencia, alumnos en riesgo y centros atrasados, al día                                    |
| Las notas se transcriben a mano desde cuadernos        | **Cuadro de calificaciones** en Excel por sección (identidad, alumno, nota por materia) para el SACE     |

## Decisiones importantes

- **Verificación en dos pasos para quien ve muchos centros.** La departamental, la distrital y la
  plataforma activan un código de su teléfono (TOTP) la primera vez que entran; hasta entonces el
  panel no muestra nada más. En las demos queda opcional (`REQUIRE_MFA=false`).

- **Puesta en marcha sin correo.** La departamental carga sus centros (con cada director) y cada
  dirección a su personal desde Excel; todos entran con su número de identidad y una contraseña
  temporal que cambian al primer ingreso. Si alguien la olvida, quien está a cargo le da otra (solo
  dentro de su ámbito). Tras 5 intentos fallidos la cuenta se bloquea 15 minutos.

- **Dinero en centavos enteros.** Nada de `float`. `packages/shared/src/money.ts` tiene el parseo,
  el formato en Lempiras, el ISV por puntos básicos con redondeo explícito y el reparto en cuotas
  sin perder centavos.
- **El colegio sale del token, nunca del body ni de la URL.** `tenantOf(request)` es la única
  fuente del tenant. Hay tests que intentan crear o modificar datos de otro colegio.
- **Tokens firmados con Ed25519.** Identity firma con la llave privada; el resto de servicios solo
  verifica con la pública (`/.well-known/jwks.json`). Comprometer un servicio de negocio no permite
  falsificar sesiones.
- **Refresh tokens con rotación y detección de robo.** Si un token ya usado se vuelve a presentar
  fuera de la ventana de gracia (30 s, para peticiones paralelas del navegador), se revoca toda la
  sesión.
- **Una persona, una cuenta, varios accesos.** Las membresías dan a cada persona un rol en un centro,
  distrito o departamento; un `CHECK` en Postgres impide que un rol quede con el ámbito equivocado.
  La sesión trabaja con un acceso y se cambia de centro sin volver a escribir la contraseña.
- **Quién ve qué centros lo decide identity.** El tablero regional de academic pide a identity
  (reenviando el token de la sesión) la lista de centros visibles; academic nunca lo decide solo.
- **Licencias y sustituciones con fechas.** Al terminar la licencia, la clase vuelve sola a su titular.
  No se cruzan licencias del mismo maestro (bloqueo por maestro) ni se puede poner de sustituto a
  alguien que también está de licencia.
- **Aislamiento entre colegios también en la base de datos.** En `academic` las llaves foráneas son
  compuestas `(school_id, id)`: aunque la API tuviera un bug, Postgres rechaza una sección colgada de
  un grado de otro colegio o una matrícula en una sección ajena.
- **Cupos sin sobreventa.** Matricular bloquea la fila de la sección (`SELECT … FOR UPDATE`) antes de
  contar. Probado contra Postgres real con 20 matrículas simultáneas en una sección de cupo 5: con el
  bloqueo entran 5; sin él entraban 8 (`services/academic/test/race.manual.ts`).
- **Importación todo o nada.** La vista previa valida cada fila (con su número) sin crear nada; al
  confirmar, todo se crea en una sola transacción. Excel suele guardar la identidad como número y
  borra el cero inicial (0801… → 801…): se restaura al leer el archivo.
- **Cuaderno sin internet sin perder nada.** Cada cambio del maestro se anota al instante en el
  dispositivo (un diario en `localStorage` y una bandeja en IndexedDB) y se envía al volver la
  conexión. Las operaciones son idempotentes: el id de cada actividad lo genera el dispositivo y las
  notas y la asistencia se sobrescriben, así que reenviar no duplica. Si una nota se rechaza (p. ej.
  mayor al valor de la actividad), el maestro ve el motivo. Un service worker guarda solo las páginas
  del cuaderno, y se borran en la pantalla de inicio de sesión (dispositivos compartidos).
- **Planificación con historial y sin pisarse.** Cada planificación guarda una copia de los campos de
  la plantilla con que se creó (cambiar la plantilla no rompe las anteriores) y un número de versión:
  si se guarda desde dos ventanas, la segunda recibe un aviso en vez de borrar lo de la primera. La
  escribe el titular o quien lo cubre esa semana; la dirección revisa pero no escribe por otros.
- **Familias: solo lo de sus hijos.** La cuenta la crea la secretaría desde la ficha del alumno, con
  la identidad del encargado (muchas familias no usan correo) y una contraseña temporal fácil de
  dictar que se cambia al entrar. Si la persona ya tenía cuenta (maestra en otra escuela, hijos en
  otro centro) solo se le agrega el acceso. Cada consulta comprueba que el alumno es suyo y del centro
  de la sesión; la secretaría no puede restablecer la contraseña de alguien que también es personal.
- **Un parcial vale 100 puntos.** El servidor no deja repartir más, ni bajar el valor de una actividad
  por debajo de notas ya puestas, ni quitar un parcial que tiene notas. Solo califica quien da la
  clase (o su sustituto mientras dura la licencia) y la dirección.
- **Bitácora de auditoría de solo inserción.** Un trigger de Postgres impide `UPDATE` y `DELETE`.
- **Login sin enumeración de usuarios.** El mismo mensaje y el mismo tiempo de respuesta para correo
  inexistente o contraseña incorrecta. Límite de 10 intentos por minuto por IP. Contraseñas con Argon2id.
- **Logs JSON con datos sensibles ocultos** (`authorization`, cookies, contraseñas, tokens) y un id
  de petición que viaja entre servicios y aparece en los errores que ve el usuario.

## Mostrar la demo en una computadora (solo Docker)

Para presentarla no hace falta instalar Node ni nada más que
[Docker Desktop](https://www.docker.com/products/docker-desktop/). Descarga el repositorio (en GitHub:
**Code → Download ZIP**, y descomprímelo) y, en una terminal dentro de esa carpeta:

```bash
docker compose -f docker-compose.demo.yml up --build
```

La primera vez tarda unos minutos (construye las imágenes y carga la demo). Cuando aparezca
**"Demo lista"**, abre http://localhost:3000. Todas las cuentas usan la contraseña
`Demo-colegio-2026`:

| Cuenta                         | Para mostrar                                                         |
| ------------------------------ | -------------------------------------------------------------------- |
| `departamental@demo-ihb.hn`    | Tablero de los 7 centros: clases sin maestro, asistencia, riesgo     |
| `distrital.roatan@demo-ihb.hn` | Lo mismo, solo los centros del distrito de Roatán                    |
| `director@demo-oak-ridge.hn`   | Licencia sin sustituto: asignarlo y ver que la alerta desaparece     |
| `director@demo-west-end.hn`    | Seguimiento: notas atrasadas, alumnos en riesgo, cuadro para el SACE |
| `maestro4@demo-west-end.hn`    | Mi cuaderno (también sin internet) y planificación semanal           |
| `shanice.bodden@demo-ihb.hn`   | Maestra en dos escuelas: «Cambiar de centro»                         |
| `0000-2026-00001`              | Familia con dos hijos: notas, asistencia, tareas y boleta            |

Para apagarla, `Ctrl+C` (o `docker compose -f docker-compose.demo.yml stop`). Las fechas de la demo se
calculan desde el día en que se carga; para dejarla como nueva antes de una presentación:

```bash
docker compose -f docker-compose.demo.yml down -v
```

y se vuelve a levantar con el primer comando. Es solo para mostrar en la propia computadora: las
contraseñas son públicas y no usa HTTPS.

### Sin Docker (Windows, computadoras sin virtualización)

Si Docker Desktop no arranca ("Virtualization support not detected") y no se quiere tocar la BIOS,
la demo también corre directo en Windows. Instala [Node.js](https://nodejs.org) (versión LTS) y
[PostgreSQL](https://www.postgresql.org/download/windows/) (anota la contraseña del usuario
`postgres`), pon la carpeta del proyecto **fuera de OneDrive** (por ejemplo `C:\demo\appAlumnos-main`)
y, en PowerShell dentro de esa carpeta:

```bash
powershell -ExecutionPolicy Bypass -File .\scripts\demo-windows.ps1
```

La primera vez pide la contraseña de `postgres`, instala, compila y carga la demo (unos minutos);
después abre el navegador. Con `-Reiniciar` deja la demo como nueva y con `-Apagar` la apaga.

## Desarrollo local

Requisitos: Node 22+, pnpm 10 (`corepack enable`) y Docker (o un Postgres 16 propio).

```bash
pnpm install
```

```bash
docker compose up -d
```

```bash
cp services/identity/.env.example services/identity/.env
```

```bash
cp services/academic/.env.example services/academic/.env
```

```bash
cp apps/web/.env.example apps/web/.env.local
```

```bash
pnpm keys:generate >> services/identity/.env
```

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

```bash
pnpm dev
```

Con los servicios corriendo, en otra terminal, carga el Colegio Demo (años, grados, secciones,
materias, docentes y 10 alumnos con hermanos). Se carga **a través de las APIs**, igual que el panel:

```bash
pnpm db:seed:demo
```

Para una **presentación a una departamental**, carga además el departamento de demostración
"Islas de la Bahía": 4 distritos, 7 escuelas públicas **ficticias** con logo, maestros (una en dos
escuelas), unos 320 alumnos, licencias con y sin sustituto, planificaciones semanales, asistencia del último mes y notas del
parcial (escuelas al día, atrasadas y una que no usa el cuaderno). Las fechas son relativas al día en
que se carga: el parcial vigente cierra en 6 días, para que se vean las alertas.

```bash
pnpm db:seed:region
```

Cuentas de la demo (contraseña `SEED_DEMO_PASSWORD`): `departamental@demo-ihb.hn`,
`distrital.roatan@demo-ihb.hn`, `director@demo-oak-ridge.hn` (tiene clases sin maestro),
`director@demo-west-end.hn` (atrasada con las notas), `maestro4@demo-west-end.hn` (cuaderno del
maestro) y `shanice.bodden@demo-ihb.hn` (maestra en dos escuelas).

- Panel: http://localhost:3000. Identity: http://localhost:3001. Academic: http://localhost:3002.
- Usuarios de prueba (con `SEED_DEMO=true`): `superadmin@escolar.local` con `SEED_SUPERADMIN_PASSWORD`,
  y `admin@`, `coordinacion@`, `finanzas@`, `secretaria@`, `docente@`, `docente2@` y
  `padre@colegio-demo.hn` con `SEED_DEMO_PASSWORD`.
- Todo en contenedores, como en AWS: `docker compose --profile full up --build`.

## Calidad

```bash
pnpm lint
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

- Los tests de `identity` y `academic` levantan un **Postgres real en memoria (PGlite)** con las
  migraciones reales: no necesitan Docker y corren igual en CI.
- Los tests de `infra` verifican la seguridad de la infraestructura (base no pública y cifrada,
  security groups, secretos fuera de variables en claro, rollback automático).
- CI (GitHub Actions) corre lint, tipos, tests, build, `cdk synth` y construye las tres imágenes
  Docker en cada push y pull request.
- **Prueba de carga con un departamento completo:** `SEED_EXTRA_SCHOOLS=93 pnpm db:seed:region` (con
  `LOGIN_RATE_LIMIT_PER_MINUTE=5000` en identity) carga 100 centros y ~5,900 alumnos con un mes de
  asistencia y notas. Medido en una computadora: tablero departamental ~1.4 s, indicadores del piloto
  ~0.6 s, Excel del departamento ~1.5 s (los centros se calculan de 4 en 4).

## Robustez

Lo que evita que un problema puntual se convierta en una caída, y cómo se comprobó:

- **Base de datos:** cada consulta tiene un límite de 30 s y cada conexión 5 s para abrirse
  (`DB_STATEMENT_TIMEOUT_MS`, `DB_CONNECT_TIMEOUT_MS`). Si la base corta conexiones (reinicio,
  cambio de zona en Multi-AZ), el servicio no se cae: responde 503 «intenta de nuevo» y sigue.
- **El cuaderno nunca pierde lo registrado:** se guarda primero en el teléfono y se reenvía hasta
  que el servidor lo confirma; un 503 se reintenta solo.
- **Despliegues sin cortes:** las consultas (GET) del panel a los servicios se reintentan una vez si
  la conexión se corta, y las conexiones se mantienen abiertas más tiempo que el balanceador y Service
  Connect (sin «502» sueltos).
- **Asistente con respaldo:** si el proveedor de IA principal falla, se usa el siguiente que tenga
  llave (ver abajo).

**Prueba de carga del cierre de parcial** ([scripts/prueba-de-carga.mjs](scripts/prueba-de-carga.mjs)):
maestros abriendo el cuaderno, guardando notas y pasando asistencia a la vez, y la dirección viendo
el seguimiento. Con la demo cargada y `identity` y `academic` corriendo:

```bash
psql postgres://escolar:escolar@localhost:5432/escolar_identity -At -c "select u.email from users u join memberships m on m.user_id = u.id where m.role = 'docente' and u.email is not null" > /tmp/maestros.txt
```

```bash
CUENTAS=/tmp/maestros.txt USUARIOS=150 DURACION=40 node scripts/prueba-de-carga.mjs
```

Medido en una computadora de 4 núcleos, con **una sola copia** de cada servicio (en AWS son 2 a 4):

| Prueba                                       | Resultado                                                   |
| -------------------------------------------- | ----------------------------------------------------------- |
| 150 maestros a la vez                        | ~380 peticiones/s, 0 errores; el 95 % responde en < 0.3 s   |
| 400 maestros a la vez                        | ~420 peticiones/s, 0 errores; el 95 % responde en ~1 s      |
| 150 maestros y la base se reinicia dos veces | 0 caídas; solo 503 «intenta de nuevo» durante cada reinicio |
| 200 inicios de sesión al mismo segundo       | todos en menos de 1 s                                       |

Escribe notas y asistencia de verdad: úsala solo con la demo o un ambiente de pruebas.

## Asistente de planificación con IA

En el editor de la planificación semanal, el docente escribe el tema (y, si quiere, indicaciones:
libro de texto, materiales, alumnos que necesitan apoyo) y el asistente llena la plantilla del centro
con un borrador según el Currículo Nacional Básico. El borrador **no se guarda**: llena el formulario
y el docente lo revisa, lo ajusta y lo guarda o lo envía como siempre.

- Funciona con **Gemini** (Google), **Groq** o **Claude** (Anthropic), con la misma indicación y la
  misma plantilla. Al modelo solo van la asignatura, el grado, el tema, los días con clase según el
  horario, el tema de la semana anterior y las indicaciones del docente; **nunca datos de alumnos**.
- Solo quien escribe la planificación lo usa, mientras está en borrador o devuelta; hasta 20
  borradores por docente al día, y cada uso queda en la bitácora del centro.
- Se activa con la llave del proveedor en `academic`; sin llave aparece como no disponible.
  `PLAN_ASSISTANT=off` lo apaga aunque haya llave.

**Gemini (capa gratuita, recomendada para el piloto).** La llave se saca gratis en
aistudio.google.com → «Get API key». Va en `GEMINI_API_KEY`; `GEMINI_MODEL` fija la versión (por
defecto `gemini-flash-latest`, el Flash más reciente: en producción conviene fijar una versión).
La capa gratuita tiene límite de consultas por minuto (si se pasa, el docente ve «llegó a su límite
de uso por ahora») y en ella Google puede usar lo que se envía para mejorar sus productos. Al crecer
a muchos centros conviene la capa de pago.

La capa gratuita es **por proyecto**: la llave tiene que ser de un proyecto **sin facturación**
(en AI Studio → Dashboard → Projects, «Nivel de facturación» dice nivel gratuito). Un proyecto con
cuenta de facturación pasa a «Nivel 1» y Google solo responde si tiene saldo prepagado; sin saldo
contesta `402 … prepayment credits are depleted` y el docente ve «no está bien configurado». Si es
el caso, crea un proyecto nuevo sin facturación y saca la llave ahí.

**Groq (capa gratuita sin tarjeta).** La llave (empieza con `gsk_`) se saca en console.groq.com →
«API Keys». Va en `GROQ_API_KEY`; `GROQ_MODEL` elige el modelo (por defecto `openai/gpt-oss-120b`,
que en Groq responde con el formato estricto de la plantilla). La capa gratuita tiene límites por
minuto y por día que alcanzan para un piloto; si se pasan, el docente ve «llegó a su límite de uso
por ahora». Groq cambia su lista de modelos seguido: si el modelo deja de existir, el docente ve «no
está bien configurado» y en los registros sale `404 model_not_found`; se arregla con `GROQ_MODEL`.

**Claude.** Llave de console.anthropic.com en `ANTHROPIC_API_KEY` (modelo `claude-opus-5-5`).

Con varias llaves se usa la primera en este orden: Claude, Gemini, Groq. `PLAN_ASSISTANT_PROVIDER`
(`claude`, `gemini` o `groq`) elige otro. **Las demás llaves quedan de respaldo:** si el principal
está ocupado, llegó a su límite o tiene la llave vencida, el borrador sale del siguiente sin que el
docente lo note (en los registros queda «se usa el de respaldo»). Un rechazo por el contenido no se
reintenta con otro. `PLAN_ASSISTANT_FALLBACK=off` usa solo el principal.

- En la demo con Docker, guarda la llave en un archivo `.env` junto a `docker-compose.demo.yml`:
  Docker Compose lo lee solo, y el proyecto lo deja fuera de git y de las imágenes. En PowerShell,
  con la llave copiada (así no aparece en pantalla):
  `Set-Content -Path .env -Value "GROQ_API_KEY=$(Get-Clipboard)" -Encoding ascii` (o
  `GEMINI_API_KEY=...`), y luego `docker compose -f docker-compose.demo.yml up`. Las variables
  definidas en la ventana de PowerShell (`$env:...`) ganan sobre el `.env`. Para ver que la tomó:
  `docker logs escolar-demo-academic-1 2>&1 | Select-String "Asistente"` debe mostrar
  «Asistente de planificación activo» con el proveedor.
- En AWS, guarda la llave como secreto (el valor del secreto es la llave) y despliega con
  `-c geminiSecretArn=arn:aws:secretsmanager:...` (o `-c groqSecretArn=...`, con `-c groqModel=...`
  si hace falta, o `-c anthropicSecretArn=...`). El balanceador y Service Connect esperan hasta 3
  minutos, porque un borrador tarda de 20 a 60 s.
- Si un borrador falla, el docente ve un mensaje sencillo; el motivo exacto (lo que respondió el
  proveedor) queda en los registros de `academic`.

## Mensajes entre el personal

Chat de dos personas entre maestros y dirección del mismo centro (las familias llegan en otra etapa).
Está en **Mensajes**, con un contador de conversaciones sin leer en el menú.

- Cada quien ve solo sus conversaciones y solo personas activas de su centro. Los mensajes **no se
  editan ni se borran** (un trigger de la base de datos lo impide): son el registro de lo que se habló.
- «✓» enviado, «✓✓» visto. La conversación se actualiza sola cada pocos segundos mientras está a la
  vista; la lista y el contador, cada pocos segundos más.
- Si alguien deja el centro, la conversación se conserva pero ya no se le escribe.
- **Fotos, videos y documentos** (botón del clip): fotos (JPG, PNG, WebP), videos cortos (MP4, MOV,
  WebM o 3GP, hasta 60 s y 50 MB) y documentos (PDF, Word, Excel, PowerPoint, hasta 10 MB), hasta 5 a
  la vez. Cada adjunto viaja en su propio mensaje y, como el texto, no se borra.
  - Las fotos se achican en el teléfono (1600 px por lado, JPEG) antes de enviarse: gastan menos datos
    y pierden los datos ocultos de la cámara, como la ubicación.
  - `identity` revisa cada archivo mientras llega: el contenido tiene que ser del tipo que dice (no se
    acepta un programa con nombre de foto) y no pasar del tamaño. Lo entrega solo a quienes están en la
    conversación, por tramos (`Range`) para que los videos se reproduzcan también en iPhone.
  - Se guardan fuera de la base de datos: en AWS, en un bucket de S3 privado y cifrado (sin enlaces
    públicos; `identity` llega a él por un endpoint de la VPC); en la demo con Docker, en el volumen
    `adjuntos`; en desarrollo, en `services/identity/.adjuntos` (`FILES_DIR` lo cambia).
  - El panel los sube por `/api/mensajes/:id/adjuntos`, fuera del proxy de `/panel`: el proxy guarda
    en memoria el cuerpo de cada petición y corta a los 10 MB.
- **Avisos al celular** (Web Push, opcional): de lunes a viernes de 6:00 a 19:00, hora de Honduras. Lo
  que llega fuera de ese horario se avisa en un solo aviso al empezar la jornada. El aviso dice quién
  escribió, nunca el texto. En iPhone hay que agregar CONECTA a la pantalla de inicio. Al cerrar sesión
  el teléfono deja de recibir avisos.
- Los avisos se activan con `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` en `identity`
  (se generan con `pnpm push:keys tu-correo@dominio.hn`); sin ellas el chat funciona sin avisos. La
  demo con Docker genera sus propias llaves; los avisos llegan si se abre por HTTPS (por ejemplo, con
  un túnel) o en `localhost`.
- En AWS: `pnpm -s push:keys tu-correo@dominio.hn --json` (en PowerShell, con
  `| Out-File -Encoding ascii push.json`), luego
  `aws secretsmanager create-secret --name escolar/dev/push --secret-string file://push.json`, borra
  `push.json` y despliega con `-c pushSecretArn=arn:aws:secretsmanager:...`.

## Licencia de las copias vendidas (Gumroad)

Las copias de CONECTA que se venden por Gumroad piden una clave de licencia; la demo y el servidor
propio no (mientras `GUMROAD_PRODUCT_ID` esté vacío en `apps/web/src/lib/brand.ts`).

1. En Gumroad, crea el producto y activa **«Generate a unique license key per sale»**. En la sección
   de licencias del producto aparece su `product_id`.
2. En la copia que vas a entregar, pon ese ID en `GUMROAD_PRODUCT_ID` (`apps/web/src/lib/brand.ts`).
3. Quien compra pone su clave en la variable de entorno `CONECTA_LICENSE_KEY` del panel web.

El panel le pregunta a Gumroad si la clave es válida (sin contarlo como otra instalación) y lo
vuelve a revisar cada 12 horas. Si la clave no existe, fue desactivada desde Gumroad, la compra se
reembolsó o tuvo contracargo, o la suscripción terminó, el panel muestra un aviso en lugar del
contenido; los datos no se tocan. Si Gumroad no responde, la instalación sigue funcionando. El
servidor web necesita salida a `api.gumroad.com`.

> Quien recibe el código fuente puede quitar esta revisión: lo que protege la venta es el contrato
> de licencia. La revisión sirve para que una copia reembolsada o desactivada deje de funcionar.

## Despliegue en AWS

Para **producción con 100 centros** (dominio con HTTPS, dos zonas, autoescalado, WAF, alarmas por
correo, 30 días de respaldos y cómo restaurarlos) sigue [docs/despliegue.md](docs/despliegue.md);
cuesta del orden de US$210 al mes. La revisión de seguridad está en [docs/seguridad.md](docs/seguridad.md).
Lo de abajo es el ambiente `dev` (de pruebas).

La primera vez:

1. Con las credenciales de AWS configuradas, crea el secreto con las llaves JWT. Nunca se guardan
   en git:

   ```bash
   pnpm -s keys:generate --json > jwt.json
   ```

   ```bash
   aws secretsmanager create-secret --name escolar/dev/identity-jwt --secret-string file://jwt.json
   ```

   ```bash
   rm jwt.json
   ```

   En PowerShell, `>` guarda el archivo en UTF-16 y AWS lo rechaza: usa
   `pnpm -s keys:generate --json | Out-File -Encoding ascii jwt.json` y `Remove-Item jwt.json`.

2. Prepara la cuenta para CDK con el ARN completo que devolvió el paso anterior. CDK arma la app para
   saber dónde instalarse, y la app no arma sin ese secreto:

   ```bash
   pnpm --filter @escolar/infra exec cdk bootstrap -c jwtSecretArn=arn:aws:secretsmanager:...
   ```

3. Despliega con el mismo ARN. Docker tiene que estar corriendo: el despliegue construye las imágenes
   en tu computadora y las sube a la cuenta.

   ```bash
   pnpm --filter @escolar/infra exec cdk deploy --all -c jwtSecretArn=arn:aws:secretsmanager:...
   ```

   Para HTTPS agrega `-c certificateArn=arn:aws:acm:...` (certificado de ACM para tu dominio).
   **Sin certificado el panel queda en HTTP: sirve para probar, nunca para datos reales.**

4. Crea el superadmin corriendo el seed una vez como tarea de ECS. Los valores salen de las
   salidas (_outputs_) del despliegue:

   ```bash
   aws ecs run-task --cluster <NombreCluster> --task-definition <IdentityTaskDefinition> --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[<SubredesPublicas>],securityGroups=[<IdentitySecurityGroup>],assignPublicIp=ENABLED}" --overrides '{"containerOverrides":[{"name":"identity","command":["node","dist/scripts/seed.js"],"environment":[{"name":"SEED_SUPERADMIN_EMAIL","value":"tu-correo@dominio.hn"},{"name":"SEED_SUPERADMIN_PASSWORD","value":"una-clave-larga-y-unica"}]}]}'
   ```

Después, cada despliegue se hace desde GitHub Actions → **Desplegar en AWS** (manual), usando un rol
IAM con OIDC (secreto `AWS_DEPLOY_ROLE_ARN` y variable `JWT_SECRET_ARN`).

**Costo aproximado del ambiente `dev`:** ALB + tres tareas Fargate pequeñas + RDS `t4g.micro`, del
orden de 55 a 70 USD al mes (menos si la cuenta tiene capa gratuita de RDS). No usa NAT Gateway: las
tareas salen a internet por IP pública y los security groups bloquean toda entrada directa. Para
producción conviene pasar a subredes privadas con VPC endpoints.

## Estructura

```
apps/web                 Next.js 16: panel por rol, cuaderno sin internet (service worker), seguimiento, alumnos, estructura académica, usuarios, colegios
services/identity        Fastify + Drizzle + Postgres: auth, tenants, usuarios, auditoría, mensajes del personal
services/academic        Fastify + Drizzle + Postgres: estructura, matrícula, licencias, notas, asistencia, tablero regional
  drizzle/               migraciones SQL versionadas
  test/                  tests de API contra Postgres en memoria
packages/service-kit     base común de microservicios
packages/shared          dinero, roles, validaciones y tipos compartidos
infra                    AWS CDK + tests de la infraestructura
docker-compose.yml       Postgres local (y todo el stack con --profile full)
```

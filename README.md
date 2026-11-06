# Plataforma Escolar

Plataforma para colegios de Honduras con tres productos sobre una misma base:

1. **Matrícula y notas:** alumnos, familias, grados y secciones, calificaciones y boletas.
2. **Facturación escolar:** colegiaturas, facturas con CAI (SAR), pagos, mora y estados de cuenta.
3. **Wallet escolar:** saldo prepagado del alumno para la cafetería o tienda del colegio.

> Nombre provisional. Se cambia en `apps/web/src/lib/brand.ts`.

## Estado

| Fase | Contenido                                                                              | Estado    |
| ---- | -------------------------------------------------------------------------------------- | --------- |
| 0    | Monorepo, CI, login, colegios (multi-tenant), usuarios y roles, infraestructura en AWS | ✅ Listo  |
| 1    | Matrícula básica: alumnos, familias, grados, año lectivo                               | Siguiente |
| 2    | Facturación de colegiatura con CAI                                                     | Pendiente |
| 3    | Wallet de cafetería (ledger de partida doble)                                          | Pendiente |
| 4    | Notas y boletas en PDF                                                                 | Pendiente |

## Arquitectura

```mermaid
flowchart LR
  navegador([Navegador]) -->|HTTPS| alb[ALB]
  alb --> web["web<br/>Next.js 16 (BFF)"]
  web -->|Service Connect<br/>http://identity:3001| identity["identity<br/>Fastify"]
  identity --> db[(RDS Postgres<br/>escolar_identity)]
  futuros["academic · billing · wallet<br/>(fases 1-3)"] -. verifican tokens con JWKS .-> identity
```

- **`apps/web`**: Next.js 16 (App Router). Funciona como _backend for frontend_: el navegador solo
  tiene cookies httpOnly, y es el servidor de Next el que llama a los microservicios.
- **`services/identity`**: colegios (tenants), usuarios, roles, login y emisión de tokens.
- **`packages/service-kit`**: base común de todos los microservicios (servidor, errores, logs,
  verificación de tokens, configuración). Los servicios nuevos (academic, billing, wallet) se
  construyen sobre esto.
- **`packages/shared`**: tipos, validaciones (Zod) y utilidades de dinero compartidas con el frontend.
- **`infra`**: AWS CDK (VPC, RDS, ECS Fargate con Service Connect, ALB).

Cada microservicio tiene **su propia base de datos** (mismo servidor Postgres en desarrollo, mismo
RDS en AWS) y nunca lee la base de otro: se comunican por API y, desde la fase 1, por eventos.

## Decisiones importantes (software financiero)

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
- **Bitácora de auditoría de solo inserción.** Un trigger de Postgres impide `UPDATE` y `DELETE`.
- **Login sin enumeración de usuarios.** El mismo mensaje y el mismo tiempo de respuesta para correo
  inexistente o contraseña incorrecta. Límite de 10 intentos por minuto por IP. Contraseñas con Argon2id.
- **Logs JSON con datos sensibles ocultos** (`authorization`, cookies, contraseñas, tokens) y un id
  de petición que viaja entre servicios y aparece en los errores que ve el usuario.

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

- Panel: http://localhost:3000. Identity: http://localhost:3001.
- Usuarios de prueba (con `SEED_DEMO=true`): `superadmin@escolar.local` con `SEED_SUPERADMIN_PASSWORD`,
  y `admin@`, `finanzas@`, `secretaria@`, `docente@` y `padre@colegio-demo.hn` con `SEED_DEMO_PASSWORD`.
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

- Los tests de `identity` levantan un **Postgres real en memoria (PGlite)** con las migraciones
  reales: no necesitan Docker y corren igual en CI.
- Los tests de `infra` verifican la seguridad de la infraestructura (base no pública y cifrada,
  security groups, secretos fuera de variables en claro, rollback automático).
- CI (GitHub Actions) corre lint, tipos, tests, build, `cdk synth` y construye las dos imágenes
  Docker en cada push y pull request.

## Despliegue en AWS

La primera vez:

1. Configura credenciales de AWS y prepara la cuenta para CDK:

   ```bash
   pnpm --filter @escolar/infra exec cdk bootstrap
   ```

2. Crea el secreto con las llaves JWT. Nunca se guardan en git:

   ```bash
   pnpm -s keys:generate --json > jwt.json
   ```

   ```bash
   aws secretsmanager create-secret --name escolar/dev/identity-jwt --secret-string file://jwt.json
   ```

   ```bash
   rm jwt.json
   ```

3. Despliega con el ARN completo que devolvió el paso anterior:

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

**Costo aproximado del ambiente `dev`:** ALB + dos tareas Fargate pequeñas + RDS `t4g.micro`, del
orden de 45 a 60 USD al mes (menos si la cuenta tiene capa gratuita de RDS). No usa NAT Gateway: las
tareas salen a internet por IP pública y los security groups bloquean toda entrada directa. Para
producción conviene pasar a subredes privadas con VPC endpoints.

## Estructura

```
apps/web                 Next.js 16: login, panel por rol, usuarios, colegios
services/identity        Fastify + Drizzle + Postgres: auth, tenants, usuarios, auditoría
  drizzle/               migraciones SQL versionadas
  test/                  tests de API contra Postgres en memoria
packages/service-kit     base común de microservicios
packages/shared          dinero, roles, validaciones y tipos compartidos
infra                    AWS CDK + tests de la infraestructura
docker-compose.yml       Postgres local (y todo el stack con --profile full)
```

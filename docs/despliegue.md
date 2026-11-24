# Despliegue en producción (100 centros)

Guía para dejar la plataforma en AWS con un dominio propio, HTTPS, respaldos y alarmas. Lo hace
una vez la persona responsable técnica, con una cuenta de AWS a nombre de quien contrata el servicio.

## Qué queda funcionando

- Panel en `https://` con el dominio elegido (HTTP redirige a HTTPS).
- Tres servicios (panel, identity, academic) con 2 copias cada uno que **suben a 4** si hay mucha
  carga (por ejemplo, a la hora de tomar asistencia en todas las escuelas).
- PostgreSQL en **dos zonas** (si una falla, la otra sigue), cifrada, sin acceso desde internet.
- **Respaldos automáticos de 30 días**: se puede volver la base a cualquier minuto de ese período.
  El respaldo diario corre a la 1:00 a. m. y las actualizaciones de AWS los domingos a las 2:00 a. m.
  (hora de Honduras), nunca en horario de clases.
- **Fotos, videos y documentos de los mensajes** con versiones: si algo se borra por error, se
  recupera durante 90 días.
- **WAF**: límite de intentos de inicio de sesión por IP y bloqueo de IPs maliciosas conocidas.
- **Alarmas por correo**: errores del panel o del balanceador, panel caído o lento, CPU y memoria
  altas, muchas conexiones, poco disco o poca memoria en la base. La base registra las consultas que
  tardan más de 1 s (en los logs de RDS en CloudWatch).
- **Si la base se reinicia o cambia de zona**, los servicios no se caen: durante esos segundos
  responden «intenta de nuevo» (el cuaderno reenvía solo lo pendiente) y se recuperan en cuanto
  vuelve. ECS no reemplaza las tareas por eso.

## Costo aproximado (us-east-1)

| Recurso                                                                        | USD/mes             |
| ------------------------------------------------------------------------------ | ------------------- |
| Base de datos t4g.small en dos zonas + 20 GB                                   | ~52                 |
| 6 tareas Fargate (panel y academic de 0.5 vCPU / 1 GB; identity de 0.25 / 0.5) | ~90                 |
| Balanceador (ALB)                                                              | ~22                 |
| IPs públicas (tareas y balanceador, US$0.005/hora cada una)                    | ~29                 |
| WAF, alarmas, logs, secretos, transferencia                                    | ~20                 |
| **Total**                                                                      | **~210 (≈ L5,700)** |

Si la carga sube y se escala a 4 tareas en horas pico, el costo sube solo durante esas horas.

## La forma fácil: desde GitHub, sin instalar nada (recomendado)

Todo se hace en la consola de AWS y en GitHub, con botones. No hace falta instalar AWS CLI, Node ni
Docker. El repositorio es público: los flujos nunca muestran llaves, contraseñas ni correos en sus
registros; las llaves se crean y se guardan directo en AWS Secrets Manager.

**Antes:** los flujos manuales de GitHub solo aparecen en **Actions** cuando están en la rama `main`
(hay que unir el pull request).

1. **Cuenta de AWS** con tarjeta. Recomendado: una alerta de gastos en AWS Budgets (por ejemplo,
   USD 250 al mes) para enterarse de cualquier sorpresa.
2. **Dominio:** por ejemplo `conecta.tuempresa.hn`, con acceso a su DNS (donde se compró el dominio).
3. **Permiso para GitHub** (una vez): en la consola de AWS, región **us-east-1 (N. Virginia)** →
   **CloudFormation → Crear pila → Cargar un archivo de plantilla** → el archivo
   [`infra/aws-github.yaml`](../infra/aws-github.yaml) (se baja de GitHub con «Download raw file») →
   nombre `conecta-github` → marcar que la pila crea recursos de IAM → **Crear**. Cuando termine, en
   **Salidas** copiar `RolArn`.
4. **En GitHub:** Settings → **Environments → New environment** `prod`. En **Deployment branches**,
   solo `main`. Dentro de ese ambiente:
   - Secreto `AWS_DEPLOY_ROLE_ARN`: el `RolArn` del paso 3.
   - Secreto `ALERT_EMAIL`: el correo que recibe las alarmas.
   - Secretos `SUPERADMIN_EMAIL` y `SUPERADMIN_PASSWORD` (mínimo 12 caracteres): la cuenta del equipo
     de la plataforma.
   - Variable `DOMINIO`: el dominio del paso 2, sin `https://`.
5. **Actions → «Preparar AWS (una vez)» → Run workflow** (`prod`). Crea las llaves, prepara la cuenta
   y pide el certificado. El resumen del flujo muestra un registro **CNAME**: crearlo en el DNS del
   dominio. AWS lo valida en minutos (a veces hasta una hora); correr el flujo otra vez dice si ya
   está ✅.
6. **Actions → «Desplegar en AWS» → Run workflow** (`prod`). La primera vez tarda unos 30 minutos.
   El resumen muestra otro **CNAME**: el dominio hacia el balanceador. Crearlo en el DNS.
   AWS manda un correo para confirmar las alarmas: aceptarlo.
7. **Actions → «Crear la cuenta del equipo de la plataforma» → Run workflow** (`prod`). Entrar en
   `https://<dominio>/login`, configurar la verificación en dos pasos y seguir con el paso 7 de abajo
   (puesta en marcha).
8. **Asistente de planificación (opcional):** en AWS **Secrets Manager → Guardar un secreto nuevo →
   Otro tipo de secreto → Texto sin formato**, con la llave de Groq, Gemini o Claude como valor y el
   nombre `escolar/prod/groq` (o `/gemini`, `/anthropic`). Volver a correr «Desplegar en AWS».
9. **Avisos en la app de Android (opcional):** un secreto `escolar/prod/fcm` con la clave
   `FCM_SERVICE_ACCOUNT` y el JSON de la cuenta de servicio de Firebase (ver
   [`apps/mobile/README.md`](../apps/mobile/README.md)). Volver a desplegar.

Para actualizar CONECTA más adelante, solo se repite el paso 6.

## Antes de empezar (forma manual)

1. Cuenta de AWS con facturación activa y un usuario con permisos de administrador.
2. AWS CLI configurado (`aws configure`) y Node 22 + pnpm en la computadora que despliega.
3. Un **dominio**, por ejemplo `escolar.ejemplo.hn` (puede ser un subdominio del dominio de quien
   contrata). Hay que poder crear registros DNS en él.

## Pasos (forma manual, con AWS CLI)

1. Crear las llaves con que se firman las sesiones (nunca se guardan en git):

   ```bash
   pnpm install
   ```

   ```bash
   pnpm -s keys:generate --json > jwt.json
   ```

   ```bash
   aws secretsmanager create-secret --name escolar/prod/identity-jwt --secret-string file://jwt.json
   ```

   ```bash
   rm jwt.json
   ```

2. Preparar la cuenta para CDK (una vez), con el ARN del secreto del paso 1. CDK arma la app para
   saber dónde instalarse, y la app no arma sin ese secreto:

   ```bash
   pnpm --filter @escolar/infra exec cdk bootstrap -c jwtSecretArn=arn:aws:secretsmanager:...
   ```

3. Pedir el certificado HTTPS del dominio en ACM y validarlo por DNS (AWS muestra un registro CNAME
   que hay que crear en el DNS del dominio; tarda unos minutos):

   ```bash
   aws acm request-certificate --domain-name escolar.ejemplo.hn --validation-method DNS
   ```

4. Desplegar producción con el ARN del secreto (paso 2), el del certificado (paso 3) y el correo
   que recibirá las alarmas:

   ```bash
   pnpm --filter @escolar/infra exec cdk deploy -c stage=prod -c jwtSecretArn=arn:aws:secretsmanager:... -c certificateArn=arn:aws:acm:... -c alertEmail=alertas@ejemplo.hn
   ```

   Sin certificado el despliegue de producción se niega a continuar. AWS manda un correo para
   confirmar la suscripción a las alarmas: hay que aceptarlo.

5. En el DNS del dominio, crear un registro CNAME de `escolar.ejemplo.hn` hacia la dirección del
   balanceador (salida `UrlPanel` del despliegue, sin el `https://`).

6. Crear la cuenta del equipo de la plataforma con la tarea de ECS del seed (ver README →
   Despliegue en AWS, paso 4).

7. Puesta en marcha de la región, desde el panel:
   1. El equipo de la plataforma crea el departamento, sus distritos y la cuenta de la dirección
      departamental (menú Departamentos).
   2. La departamental entra y usa **Cargar centros** con el Excel de sus centros y directores, e
      imprime la hoja de accesos.
   3. Cada director entra con su identidad, cambia su contraseña y usa **Cargar personal desde
      Excel**; luego carga a sus alumnos (Alumnos → Importar) y da acceso a las familias.

## Restaurar un respaldo

RDS guarda respaldos automáticos de los últimos 30 días y permite volver la base **a cualquier
minuto** de ese período. Restaurar crea una base nueva; la actual no se toca hasta que se cambie.

1. Ver el nombre de la base (salida `BaseDeDatos` del despliegue) y elegir el momento al que volver
   (hora UTC, antes del problema).

2. Restaurar a una instancia nueva:

   ```bash
   aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier NOMBRE-DE-LA-BASE --target-db-instance-identifier escolar-restaurada --restore-time 2026-11-10T14:00:00Z --db-subnet-group-name GRUPO-DE-SUBREDES --vpc-security-group-ids GRUPO-DE-SEGURIDAD --no-publicly-accessible
   ```

   El grupo de subredes y el de seguridad son los de la base actual (`aws rds describe-db-instances`).

3. Cuando la nueva base esté disponible, revisar los datos y apuntar los servicios a ella: en Secrets
   Manager, en el secreto de credenciales de la base, cambiar `host` por la dirección de la nueva
   instancia, y forzar un nuevo despliegue de los tres servicios:

   ```bash
   aws ecs update-service --cluster NOMBRE-DEL-CLUSTER --service NOMBRE-DEL-SERVICIO --force-new-deployment
   ```

4. Cuando todo funcione, borrar la base vieja (queda un snapshot final por la política de
   eliminación).

**Recomendado:** antes de cada actualización importante, tomar un snapshot manual
(`aws rds create-db-snapshot`) y **practicar una restauración una vez por trimestre**, para saber
cuánto tarda y que el procedimiento funciona.

## Pendiente antes de abrir a las 100 escuelas

Ver [docs/seguridad.md](seguridad.md): prueba de penetración externa y convenio de protección de datos
con la Secretaría de Educación. La verificación en dos pasos ya está activa: en producción no se define
`REQUIRE_MFA` (vale `true`); `REQUIRE_MFA=false` es solo para las demos.

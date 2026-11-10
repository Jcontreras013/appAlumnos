# Despliegue en producción (100 centros)

Guía para dejar la plataforma en AWS con un dominio propio, HTTPS, respaldos y alarmas. Lo hace
una vez la persona responsable técnica, con una cuenta de AWS a nombre de quien contrata el servicio.

## Qué queda funcionando

- Panel en `https://` con el dominio elegido (HTTP redirige a HTTPS).
- Tres servicios (panel, identity, academic) con 2 copias cada uno que **suben a 4** si hay mucha
  carga (por ejemplo, a la hora de tomar asistencia en todas las escuelas).
- PostgreSQL en **dos zonas** (si una falla, la otra sigue), cifrada, sin acceso desde internet.
- **Respaldos automáticos de 30 días**: se puede volver la base a cualquier minuto de ese período.
- **WAF**: límite de intentos de inicio de sesión por IP y bloqueo de IPs maliciosas conocidas.
- **Alarmas por correo**: errores del panel, panel caído, CPU y memoria altas, poco disco o poca
  memoria en la base.

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

## Antes de empezar

1. Cuenta de AWS con facturación activa y un usuario con permisos de administrador.
2. AWS CLI configurado (`aws configure`) y Node 22 + pnpm en la computadora que despliega.
3. Un **dominio**, por ejemplo `escolar.ejemplo.hn` (puede ser un subdominio del dominio de quien
   contrata). Hay que poder crear registros DNS en él.

## Pasos

1. Preparar la cuenta para CDK (una vez):

   ```bash
   pnpm install
   ```

   ```bash
   pnpm --filter @escolar/infra exec cdk bootstrap
   ```

2. Crear las llaves con que se firman las sesiones (nunca se guardan en git):

   ```bash
   pnpm -s keys:generate --json > jwt.json
   ```

   ```bash
   aws secretsmanager create-secret --name escolar/prod/identity-jwt --secret-string file://jwt.json
   ```

   ```bash
   rm jwt.json
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

Ver [docs/seguridad.md](seguridad.md): segundo factor para la departamental y la plataforma, prueba de
penetración externa y convenio de protección de datos con la Secretaría de Educación.

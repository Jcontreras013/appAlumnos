# Seguridad

Revisión hecha antes de operar con 100 centros. Resume cómo se protege cada cosa, qué se corrigió en
esta revisión y qué queda pendiente o se acepta conscientemente.

## Cómo está protegido

| Tema                             | Cómo                                                                                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contraseñas                      | Argon2id (parámetros OWASP). Mínimo 10 caracteres. Las temporales se cambian al primer ingreso.                                                                                                                                         |
| Intentos de adivinar contraseñas | 10 intentos por minuto por IP y, por cuenta, bloqueo de 15 minutos tras 5 fallos seguidos (contador atómico en SQL).                                                                                                                    |
| Enumeración de cuentas           | Mismo mensaje y mismo tiempo de respuesta para usuario inexistente, contraseña mala, cuenta bloqueada o desactivada. Fuera de su ámbito, una cuenta "no existe" (404).                                                                  |
| Sesiones                         | Access token Ed25519 de 15 minutos; refresh token con rotación y detección de reuso (se revoca toda la sesión). Cookies httpOnly, SameSite=Lax y Secure con HTTPS. Restablecer una contraseña cierra todas las sesiones de esa persona. |
| Aislamiento entre centros        | El centro sale siempre del token, nunca de la petición. En academic las llaves foráneas son compuestas (centro, id): Postgres rechaza cruces aunque la API fallara. Hay pruebas que intentan leer y escribir datos de otro centro.      |
| Familias                         | Cada consulta verifica que el alumno esté enlazado a la cuenta y sea del centro de la sesión. Pruebas de alumno ajeno y de otro centro.                                                                                                 |
| Permisos por rol                 | Todas las rutas de academic exigen roles concretos. Restablecer contraseñas solo dentro del ámbito propio (dirección → su personal; distrital/departamental → sus centros; nadie a la plataforma).                                      |
| CSRF                             | Server actions de Next.js validan el origen; la ruta de sincronización del cuaderno exige `Sec-Fetch-Site: same-origin` y JSON.                                                                                                         |
| Inyección SQL                    | Solo consultas parametrizadas (Drizzle).                                                                                                                                                                                                |
| XSS                              | React escapa todo; las ventanas de impresión (cartas y hojas de acceso) escapan cada dato. Política de contenido (CSP) en producción.                                                                                                   |
| Encabezados                      | CSP, HSTS (con HTTPS), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.                                                                                                                                     |
| Bitácora                         | Tabla de auditoría de solo inserción (un trigger impide modificarla). Inicios de sesión fallidos, bloqueos, restablecimientos, accesos de familias e importaciones quedan registrados.                                                  |
| Logs                             | JSON con autorización, cookies, contraseñas (también temporales) y tokens ocultos. De un intento con usuario inexistente solo se guarda el inicio de lo escrito.                                                                        |
| Datos en reposo                  | RDS cifrada; respaldos cifrados; la base no es accesible desde internet.                                                                                                                                                                |
| Dependencias                     | `pnpm audit --prod` en CI (falla con vulnerabilidades altas o críticas).                                                                                                                                                                |
| Secretos                         | Llaves JWT en AWS Secrets Manager; `.env` fuera de git.                                                                                                                                                                                 |

## Corregido en esta revisión

- Política de contenido (CSP) y HSTS en el panel.
- Ocultar en los logs las contraseñas temporales y los campos de cambio de contraseña.
- No guardar completa la identidad o el correo de un intento de inicio de sesión fallido.
- Auditoría de dependencias en cada push.

## Pendiente o aceptado

| Riesgo                                                                                                                | Decisión                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alguien que conozca la identidad de otra persona puede bloquearle la cuenta 15 minutos escribiendo mal la contraseña. | Aceptado: es el costo de frenar ataques de adivinación. La dirección la desbloquea con una contraseña temporal. En producción se suma un límite por IP en el balanceador (WAF). |
| Las cuentas de la departamental y de la plataforma no tienen segundo factor (2FA).                                    | Recomendado antes de producción: 2FA con app de autenticación para esos roles.                                                                                                  |
| La CSP permite scripts en línea (`unsafe-inline`), que Next.js usa para los datos de cada página.                     | Mejora futura: CSP con nonce por petición.                                                                                                                                      |
| No se revisa si una contraseña aparece en filtraciones conocidas.                                                     | Mejora futura (lista local de contraseñas comunes).                                                                                                                             |
| Archivos Excel: un archivo malicioso muy comprimido podría consumir memoria al leerse.                                | Mitigado con el límite de 4 MB; revisar en la prueba de penetración.                                                                                                            |
| Protección de datos de menores.                                                                                       | Antes de producción: convenio de confidencialidad con la Secretaría de Educación, aviso de privacidad para familias y procedimiento de borrado al terminar el contrato.         |
| Prueba de penetración externa.                                                                                        | Recomendada antes de abrir a las 100 escuelas.                                                                                                                                  |

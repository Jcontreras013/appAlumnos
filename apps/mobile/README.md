# App de CONECTA para Android

La app de Play Store. No es otra versión de CONECTA: abre la plataforma publicada (la misma dirección
que se usa en el navegador). Así, cada mejora que se publica en CONECTA llega a la app el mismo día, sin
subir una versión nueva a Play Store. Está hecha con [Capacitor](https://capacitorjs.com) (MIT).

Lo que agrega la app al navegador:

- **Ícono propio** en el teléfono y pantalla de inicio con la marca.
- **Descargas**: los libros de la biblioteca, los adjuntos, los Excel y los Word del panel se guardan en
  «Descargas» (el visor web de Android no descarga nada por su cuenta).
- **Cámara y archivos** al adjuntar en los mensajes o subir a la biblioteca.
- **Sin internet**: el cuaderno del maestro y los libros guardados se abren sin señal (el service worker
  de CONECTA funciona igual dentro de la app). Si la app se abre sin conexión por primera vez, muestra
  una pantalla propia con «Volver a intentar».
- **Botón «atrás»** de Android: vuelve a la pantalla anterior; en la primera, cierra la app.
- **Avisos del teléfono** de los mensajes, por Firebase (el visor de la app no tiene los avisos del
  navegador). Mismo horario que en la web y nunca el texto del mensaje. Al tocar el aviso se abre la
  conversación.

## Compilar

No hace falta Android Studio: la compila GitHub Actions (`.github/workflows/android.yml`) cada vez que
cambia algo en `apps/mobile`, o a mano desde la pestaña **Actions → App Android → Run workflow**.

- **APK de prueba** (`conecta-prueba-apk`): se instala directo en un teléfono Android (hay que permitir
  «instalar apps de origen desconocido»). Sirve para probar antes de publicar.
- **AAB para Play Store**: sale del flujo aparte **Actions → App Android para Play Store**, firmado con
  la llave guardada en AWS (ver abajo, paso 4).

En una computadora con Android Studio también se puede: `pnpm install`, `pnpm --filter @escolar/mobile
sync` y abrir la carpeta `apps/mobile/android`.

## Publicar en Play Store, paso a paso

1. **Cuenta de desarrollador de Google Play** (pago único de USD 25) a nombre de la empresa, en
   <https://play.google.com/console>. Para una organización, Google pide verificar la empresa (número
   D-U-N-S): conviene empezar este trámite primero porque tarda unos días.
2. **CONECTA publicada con su dominio y https** (por ejemplo `https://conecta.tuempresa.hn`). Esa es la
   dirección que abre la app. Se publica desde GitHub, sin instalar nada:
   [docs/despliegue.md → La forma fácil](../../docs/despliegue.md).
3. **Decidir el identificador de la app** (por defecto `com.jcsystem.conecta`). Es permanente: después
   de la primera publicación no se puede cambiar. Si se quiere otro, cambiarlo antes en
   `android/app/build.gradle` (`namespace` y `applicationId`), en
   `android/app/src/main/res/values/strings.xml`, en la carpeta de `MainActivity.java` y en
   `capacitor.config.ts`.
4. **Compilar la versión para Play Store**: Actions → **«App Android para Play Store»** → Run
   workflow, con el ambiente cuya dirección debe abrir la app (usa su variable `DOMINIO`, o la
   variable `CONECTA_URL` si está). La primera vez crea la **llave de firma** y la guarda en AWS
   Secrets Manager (`escolar/android/firma`); las siguientes usan la misma. Nadie tiene que guardar
   archivos ni contraseñas: con «Firma de apps de Play», si un día se perdiera, Google permite
   cambiarla. Bajar el artefacto `conecta-play-store-<número>` (adentro está `app-release.aab`).
5. **En Play Console**: crear la app y completar la ficha y los cuestionarios con lo que está en
   [`store/ficha-play-store.md`](store/ficha-play-store.md): textos, capturas (`store/capturas/`),
   ícono, gráfico destacado, política de privacidad, seguridad de los datos, clasificación, público
   objetivo y la cuenta de prueba para la revisión de Google.
6. **Subir el AAB** primero a «Prueba interna» (hasta 100 personas, sin revisión larga), probarlo y
   después pasarlo a «Producción». Al subir el primero, dejar **«Firma de apps de Play»** (la opción
   recomendada). Las cuentas personales nuevas deben hacer antes una prueba cerrada
   con al menos 12 personas durante 14 días; las de organización, no.

Cada nueva compilación sube sola el número de versión (`versionCode` = número de la compilación en
GitHub Actions). Solo hace falta publicar una versión nueva de la app cuando cambia algo de
`apps/mobile` (ícono, permisos, avisos…); los cambios de CONECTA llegan solos.

## Avisos del teléfono (Firebase)

Sin esto la app funciona igual, pero no avisa de los mensajes. Se hace una sola vez:

1. En <https://console.firebase.google.com>, crear un proyecto (sin Google Analytics) y agregarle una
   **app de Android** con el identificador de la app (por defecto `com.jcsystem.conecta`).
2. Descargar el **`google-services.json`** y guardarlo completo en GitHub como el secreto
   `GOOGLE_SERVICES_JSON`. No es una llave secreta, pero no hace falta que esté en el repositorio.
3. En Firebase → Configuración del proyecto → **Cuentas de servicio** → «Generar nueva clave privada».
   Ese JSON **sí es secreto**: va solo al servidor de CONECTA, nunca al repositorio ni a la app.
   - En AWS: crear un secreto con la clave `FCM_SERVICE_ACCOUNT` y el JSON como valor, y desplegar con
     `-c fcmSecretArn=arn:aws:secretsmanager:...` (ver el README principal).
   - En la demo con Docker: la variable `FCM_SERVICE_ACCOUNT` del servicio `identity`.
4. Compilar la app otra vez. En la app, «Mensajes» → «Activar avisos».

## Seguridad

- La app solo abre la dirección de CONECTA; los enlaces a otros sitios (Educatrachos, videos) se abren
  en el navegador del teléfono.
- La versión de Play Store solo acepta https. La de prueba permite `http://10.0.2.2:3000` (el CONECTA
  local visto desde el emulador de Android).
- Sin copia de seguridad en la nube de Google (`allowBackup="false"`): la sesión no se copia a otro
  teléfono.
- No pide permiso de almacenamiento: las descargas van a «Descargas» por el sistema.

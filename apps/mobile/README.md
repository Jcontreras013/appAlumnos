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

## Compilar

No hace falta Android Studio: la compila GitHub Actions (`.github/workflows/android.yml`) cada vez que
cambia algo en `apps/mobile`, o a mano desde la pestaña **Actions → App Android → Run workflow**.

- **APK de prueba** (`conecta-prueba-apk`): se instala directo en un teléfono Android (hay que permitir
  «instalar apps de origen desconocido»). Sirve para probar antes de publicar.
- **AAB para Play Store** (`conecta-play-store-aab`): solo si están los secretos de la llave de firma.

En una computadora con Android Studio también se puede: `pnpm install`, `pnpm --filter @escolar/mobile
sync` y abrir la carpeta `apps/mobile/android`.

## Publicar en Play Store, paso a paso

1. **Cuenta de desarrollador de Google Play** (pago único de USD 25) a nombre de la empresa, en
   <https://play.google.com/console>. Para una organización, Google pide verificar la empresa (número
   D-U-N-S): conviene empezar este trámite primero porque tarda unos días.
2. **CONECTA publicada con su dominio y https** (por ejemplo `https://conecta.tuempresa.hn`). Esa es la
   dirección que abre la app.
3. **Decidir el identificador de la app** (por defecto `com.jcsystem.conecta`). Es permanente: después
   de la primera publicación no se puede cambiar. Si se quiere otro, cambiarlo antes en
   `android/app/build.gradle` (`namespace` y `applicationId`), en
   `android/app/src/main/res/values/strings.xml`, en la carpeta de `MainActivity.java` y en
   `capacitor.config.ts`.
4. **Crear la llave de firma** (una sola vez, en cualquier computadora con Java):

   ```bash
   keytool -genkeypair -v -keystore conecta.keystore -alias conecta -keyalg RSA -keysize 2048 -validity 10000
   ```

   Guardar el archivo y las contraseñas en un lugar seguro (si se pierden, no se puede actualizar la
   app). **Nunca** se suben al repositorio.
5. **En GitHub** (Settings → Secrets and variables → Actions):
   - Variable `CONECTA_URL`: la dirección del paso 2.
   - Secretos: `ANDROID_KEYSTORE_BASE64` (el archivo en base64: `base64 -w0 conecta.keystore` en Linux o
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes("conecta.keystore"))` en PowerShell),
     `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`conecta`) y `ANDROID_KEY_PASSWORD`.
6. **Compilar**: Actions → App Android → Run workflow. Bajar el artefacto `conecta-play-store-aab`.
7. **En Play Console**: crear la app, completar la ficha (descripción, capturas del teléfono, el ícono
   `store/icono-512.png` y el gráfico `store/grafico-destacado-1024x500.png`), la **política de
   privacidad** (`https://<tu dominio>/privacidad`), el cuestionario de **seguridad de los datos** y el de
   **clasificación del contenido**. Para la revisión de Google hay que dar un **usuario de prueba**
   (por ejemplo, una cuenta de maestro de un centro de demostración).
8. **Subir el AAB** primero a «Prueba interna» (hasta 100 personas, sin revisión larga), probarlo y
   después pasarlo a «Producción». Las cuentas personales nuevas deben hacer antes una prueba cerrada
   con al menos 12 personas durante 14 días; las de organización, no.

Cada nueva compilación sube sola el número de versión (`versionCode` = número de la compilación en
GitHub Actions). Solo hace falta publicar una versión nueva de la app cuando cambia algo de
`apps/mobile` (ícono, permisos, avisos…); los cambios de CONECTA llegan solos.

## Seguridad

- La app solo abre la dirección de CONECTA; los enlaces a otros sitios (Educatrachos, videos) se abren
  en el navegador del teléfono.
- La versión de Play Store solo acepta https. La de prueba permite `http://10.0.2.2:3000` (el CONECTA
  local visto desde el emulador de Android).
- Sin copia de seguridad en la nube de Google (`allowBackup="false"`): la sesión no se copia a otro
  teléfono.
- No pide permiso de almacenamiento: las descargas van a «Descargas» por el sistema.

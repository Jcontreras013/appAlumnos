package com.jcsystem.conecta;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Descargas dentro de la app. El visor web de Android no descarga archivos por su cuenta: aquí se
 * bajan los libros, los adjuntos y los Excel del panel (con la sesión de la app) a «Descargas», y la
 * página puede guardar los archivos que arma ella misma (el Word de un documento, el CSV de accesos).
 */
@CapacitorPlugin(name = "ConectaApp")
public class ConectaAppPlugin extends Plugin {

    private static final Pattern FILENAME_STAR = Pattern.compile("filename\\*\\s*=\\s*UTF-8''([^;]+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern FILENAME = Pattern.compile("filename\\s*=\\s*\"?([^\";]+)\"?", Pattern.CASE_INSENSITIVE);
    private final ExecutorService background = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        WebView webView = getBridge().getWebView();
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) ->
            download(url, userAgent, contentDisposition, mimeType)
        );
    }

    /** Un enlace de descarga: lo baja Android (con aviso y en «Descargas»). */
    private void download(String url, String userAgent, String contentDisposition, String mimeType) {
        if (url.startsWith("blob:")) {
            saveBlobUrl(url, fileName(url, contentDisposition, mimeType), mimeType);
            return;
        }
        if (!url.startsWith("https://") && !url.startsWith("http://")) return;
        final String name = fileName(url, contentDisposition, mimeType);
        background.execute(() -> {
            // Antes de entregar la sesión a Android se renueva aquí: así la descarga no gasta la
            // renovación que la app necesita después.
            if (isConecta(url)) refreshSession(url);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) request.addRequestHeader("Cookie", cookies);
            request.addRequestHeader("User-Agent", userAgent);
            request.setMimeType(mimeType);
            request.setTitle(name);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            } else {
                // Sin pedir permiso de almacenamiento en teléfonos viejos: queda en la carpeta de la app.
                request.setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, name);
            }
            try {
                DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
                manager.enqueue(request);
                toast("Descargando " + name + "…");
            } catch (Exception e) {
                toast("No se pudo descargar el archivo.");
            }
        });
    }

    /** Guarda un archivo que armó la página (en base64). */
    @PluginMethod
    public void saveFile(PluginCall call) {
        String data = call.getString("data");
        String name = safeName(call.getString("fileName", "archivo"));
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (data == null) {
            call.reject("Falta el archivo");
            return;
        }
        background.execute(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                Uri uri = write(bytes, name, mimeType);
                JSObject result = new JSObject();
                result.put("fileName", name);
                call.resolve(result);
                toast("Guardado en Descargas: " + name);
                open(uri, mimeType);
            } catch (Exception e) {
                call.reject("No se pudo guardar el archivo", e);
            }
        });
    }

    private Uri write(byte[] bytes, String name, String mimeType) throws IOException {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = context.getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("Sin acceso a Descargas");
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IOException("Sin acceso a Descargas");
                out.write(bytes);
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
            return uri;
        }
        File folder = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (folder == null) throw new IOException("Sin almacenamiento");
        if (!folder.exists() && !folder.mkdirs()) throw new IOException("Sin almacenamiento");
        File file = new File(folder, name);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        return FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
    }

    /** Abre el archivo recién guardado con la app que corresponda (Word, Excel, lector de PDF…). */
    private void open(Uri uri, String mimeType) {
        main.post(() -> {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, mimeType);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(intent);
            } catch (ActivityNotFoundException e) {
                // No hay una app para abrirlo: queda en Descargas.
            }
        });
    }

    /** Un archivo armado en la página (blob:) que se descargó con un enlace: la página lo lee y lo manda aquí. */
    private void saveBlobUrl(String url, String name, String mimeType) {
        String script =
            "(async () => {" +
            "  const blob = await (await fetch(" + jsString(url) + ")).blob();" +
            "  const data = await new Promise((done) => { const r = new FileReader(); r.onload = () => done(String(r.result).split(',')[1] || ''); r.readAsDataURL(blob); });" +
            "  await window.Capacitor.Plugins.ConectaApp.saveFile({ data, fileName: " + jsString(name) + ", mimeType: blob.type || " + jsString(mimeType) + " });" +
            "})()";
        main.post(() -> getBridge().getWebView().evaluateJavascript(script, null));
    }

    private boolean isConecta(String url) {
        String server = getBridge().getServerUrl();
        if (server == null) return false;
        Uri target = Uri.parse(url);
        Uri app = Uri.parse(server);
        return target.getHost() != null && target.getHost().equalsIgnoreCase(app.getHost());
    }

    /** Pasa por el panel para que la sesión se renueve, y guarda las cookies nuevas en la app. */
    private void refreshSession(String url) {
        HttpURLConnection connection = null;
        try {
            Uri target = Uri.parse(url);
            String origin = target.getScheme() + "://" + target.getEncodedAuthority();
            connection = (HttpURLConnection) new URL(origin + "/panel/sesion").openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(10_000);
            String cookies = CookieManager.getInstance().getCookie(origin);
            if (cookies != null) connection.setRequestProperty("Cookie", cookies);
            connection.getResponseCode();
            List<String> fresh = connection.getHeaderFields().get("Set-Cookie");
            if (fresh != null) {
                for (String cookie : fresh) CookieManager.getInstance().setCookie(origin, cookie);
                CookieManager.getInstance().flush();
            }
        } catch (IOException e) {
            // Sin conexión: la descarga fallará y Android lo avisa.
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /** El nombre del archivo: el que dice el servidor (también con tildes y ñ), o uno a partir de la dirección. */
    static String fileName(String url, String contentDisposition, String mimeType) {
        String name = null;
        if (contentDisposition != null) {
            Matcher star = FILENAME_STAR.matcher(contentDisposition);
            if (star.find()) {
                try {
                    name = URLDecoder.decode(star.group(1).trim(), StandardCharsets.UTF_8.name());
                } catch (Exception ignored) {
                    name = null;
                }
            }
            if (name == null) {
                Matcher plain = FILENAME.matcher(contentDisposition);
                if (plain.find()) name = plain.group(1).trim();
            }
        }
        if (name == null || name.isEmpty()) name = URLUtil.guessFileName(url, contentDisposition, mimeType);
        String clean = safeName(name);
        if (!clean.contains(".") && mimeType != null) {
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
            if (ext != null) clean = clean + "." + ext;
        }
        return clean;
    }

    static String safeName(String name) {
        String clean = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]+", " ").trim();
        if (clean.isEmpty() || clean.startsWith(".")) clean = "archivo" + clean;
        return clean.length() > 120 ? clean.substring(clean.length() - 120) : clean;
    }

    private static String jsString(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ") + "\"";
    }

    private void toast(String message) {
        main.post(() -> Toast.makeText(getContext(), message, Toast.LENGTH_SHORT).show());
    }
}

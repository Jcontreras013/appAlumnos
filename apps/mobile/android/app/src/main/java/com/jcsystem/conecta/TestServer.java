package com.jcsystem.conecta;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.text.InputType;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.appcompat.app.AlertDialog;
import com.getcapacitor.CapConfig;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * Solo en la app de prueba (APK de prueba, no la de Play Store): la dirección de CONECTA se escribe
 * en el teléfono, así se prueba contra la demo de una computadora (por su IP en el wifi o por un
 * túnel https) sin compilar otra app. Para cambiarla: mantener presionado el ícono → «Cambiar
 * servidor».
 */
final class TestServer {

    static final String CHANGE_ACTION = "conecta.CAMBIAR_SERVIDOR";
    private static final String PREFS = "conecta_prueba";
    private static final String KEY = "servidor";

    private TestServer() {}

    static boolean isTestBuild(Context context) {
        return (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    static String saved(Context context) {
        return prefs(context).getString(KEY, null);
    }

    /** La configuración con la que se compiló la app (capacitor.config.json de los assets). */
    private static JSONObject builtConfig(Context context) throws Exception {
        try (InputStream in = context.getAssets().open("capacitor.config.json")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int n; (n = in.read(buffer)) > 0; ) bytes.write(buffer, 0, n);
            return new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
        }
    }

    /** La dirección https con la que se compiló (CONECTA_URL); null si es la de prueba local. */
    private static String builtUrl(Context context) {
        try {
            JSONObject server = builtConfig(context).optJSONObject("server");
            String url = server == null ? null : server.optString("url", null);
            return url != null && url.startsWith("https://") ? url : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** La configuración de Capacitor con la dirección elegida; null si todavía no se eligió. */
    static CapConfig config(Context context) {
        String url = saved(context);
        if (url == null) return null;
        try {
            JSONObject json = builtConfig(context);
            JSONObject server = json.optJSONObject("server");
            if (server == null) server = new JSONObject();
            server.put("url", url);
            server.put("cleartext", url.startsWith("http://"));
            json.put("server", server);
            File dir = new File(context.getFilesDir(), "prueba");
            if (!dir.exists() && !dir.mkdirs()) return null;
            try (OutputStream out = new FileOutputStream(new File(dir, "capacitor.config.json"))) {
                out.write(json.toString().getBytes(StandardCharsets.UTF_8));
            }
            return CapConfig.loadFromFile(context, dir.getAbsolutePath());
        } catch (Exception e) {
            return null;
        }
    }

    /** «192.168.1.10:3000» → «http://192.168.1.10:3000/panel». null si no es una dirección. */
    static String normalize(String input) {
        String value = input == null ? "" : input.trim();
        if (value.isEmpty()) return null;
        if (!value.matches("(?i)^https?://.*")) value = "http://" + value;
        Uri uri = Uri.parse(value);
        if (uri.getHost() == null || uri.getHost().isEmpty()) return null;
        String path = uri.getPath() == null ? "" : uri.getPath().replaceAll("/+$", "");
        if (path.isEmpty()) path = "/panel";
        return uri.getScheme().toLowerCase() + "://" + uri.getEncodedAuthority() + path;
    }

    /** Pide la dirección y vuelve a abrir la app con ella. */
    static void ask(Activity activity) {
        String current = saved(activity);
        // La primera vez trae escrita la dirección publicada (CONECTA_URL): basta con «Abrir».
        String suggested = current != null ? current : builtUrl(activity);
        EditText input = new EditText(activity);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        input.setHint("https://….trycloudflare.com");
        if (suggested != null) input.setText(suggested.replaceAll("/panel$", ""));
        FrameLayout frame = new FrameLayout(activity);
        int padding = (int) (20 * activity.getResources().getDisplayMetrics().density);
        frame.setPadding(padding, 0, padding, 0);
        frame.addView(input);
        new AlertDialog.Builder(activity)
            .setTitle("¿Dónde está CONECTA?")
            .setMessage(
                "App de prueba. Toca «Abrir» para usar la dirección escrita, o cambia por la de un túnel " +
                "(https://….trycloudflare.com) o la de tu computadora en el mismo wifi (por ejemplo " +
                "192.168.1.10:3000)."
            )
            .setView(frame)
            .setCancelable(current != null)
            .setPositiveButton("Abrir", (dialog, which) -> {
                String url = normalize(input.getText().toString());
                if (url == null) {
                    Toast.makeText(activity, "Esa dirección no es válida", Toast.LENGTH_LONG).show();
                    ask(activity);
                    return;
                }
                prefs(activity).edit().putString(KEY, url).apply();
                activity.recreate();
            })
            .show();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}

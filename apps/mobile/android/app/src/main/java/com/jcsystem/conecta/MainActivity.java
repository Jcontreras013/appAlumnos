package com.jcsystem.conecta;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;

/** La app abre CONECTA (ver capacitor.config.ts) y suma lo que el navegador del teléfono no hace solo. */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ConectaAppPlugin.class);
        boolean testBuild = TestServer.isTestBuild(this);
        // App de prueba: abre la dirección que se escribió en el teléfono (si ya se eligió una).
        if (testBuild) config = TestServer.config(this);
        super.onCreate(savedInstanceState);
        if (bridge != null) {
            // La pantalla de «sin conexión» la usa para «Volver a intentar».
            bridge.getWebView().addJavascriptInterface(new AppInfo(bridge.getServerUrl()), "ConectaNativo");
        }
        if (testBuild && (TestServer.saved(this) == null || isChangeRequest(getIntent()))) {
            setIntent(new Intent(Intent.ACTION_MAIN));
            TestServer.ask(this);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (TestServer.isTestBuild(this) && isChangeRequest(intent)) TestServer.ask(this);
    }

    private static boolean isChangeRequest(Intent intent) {
        return intent != null && TestServer.CHANGE_ACTION.equals(intent.getAction());
    }

    /** Lo que la página puede saber de la app (nada personal). */
    static final class AppInfo {

        private final String serverUrl;

        AppInfo(String serverUrl) {
            this.serverUrl = serverUrl;
        }

        @JavascriptInterface
        public String serverUrl() {
            return serverUrl == null ? "" : serverUrl;
        }
    }
}

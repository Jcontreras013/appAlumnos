package com.jcsystem.conecta;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/** La app abre CONECTA (ver capacitor.config.ts) y suma lo que el navegador del teléfono no hace solo. */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ConectaAppPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

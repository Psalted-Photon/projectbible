package com.irisbible.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins, which live in this folder rather than in npm
        // packages, so they must be named here before the bridge starts.
        registerPlugin(IrisFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

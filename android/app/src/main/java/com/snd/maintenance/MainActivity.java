package com.snd.maintenance;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private BroadcastReceiver screenReceiver;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_OFF);

        screenReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent != null && Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                    if (getBridge() != null) {
                        try {
                            getBridge().triggerWindowJSEvent("snd_screen_off");
                        } catch (Exception ignored) {}
                        try {
                            if (getBridge().getWebView() != null) {
                                getBridge().getWebView().post(new Runnable() {
                                    @Override
                                    public void run() {
                                        getBridge().getWebView().evaluateJavascript(
                                            "window.dispatchEvent(new CustomEvent('snd_screen_off'));", 
                                            null
                                        );
                                    }
                                });
                            }
                        } catch (Exception ignored) {}
                    }
                }
            }
        };

        registerReceiver(screenReceiver, filter);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (screenReceiver != null) {
            try {
                unregisterReceiver(screenReceiver);
            } catch (Exception ignored) {}
        }
    }
}


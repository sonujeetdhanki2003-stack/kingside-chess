package com.sonujeet.kingside;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Kingside Chess: the game's own files ship inside the APK and are served at the live site's
 * address, so vs-computer and 2-player work with no connection, while /api/* (online play)
 * goes to the live server as a normal same-origin request.
 */
public class MainActivity extends Activity {
    static final String HOST = "sonujeet-chess.sites.tab.bot";
    static final String HOME = "https://" + HOST + "/";
    static final int BG = 0xFF0F1115;

    private WebView web;
    private FrameLayout root;
    private long lastBack = 0;
    private Object backCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window win = getWindow();
        win.setStatusBarColor(BG);
        win.setNavigationBarColor(BG);

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        createWebView();
        setContentView(root);

        if (Build.VERSION.SDK_INT >= 30) {
            // Draw edge to edge on every version (Android 15+ forces it) and pad the page clear of
            // the status bar, the navigation bar, display cutouts and the keyboard.
            win.setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                return WindowInsets.CONSUMED;
            });
            if (win.getInsetsController() != null) {
                // light (white) status-bar icons on the dark bar
                win.getInsetsController().setSystemBarsAppearance(0,
                        android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            }
        }

        if (Build.VERSION.SDK_INT >= 33) registerBack();
        Reminders.schedule(this); // v1.7: keep the daily reminder alarm set after an update or a restart

        String start = urlFrom(getIntent());
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        if (savedInstanceState == null || web.getUrl() == null) web.loadUrl(start != null ? start : HOME);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void createWebView() {
        web = new WebView(this);
        web.setBackgroundColor(BG);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // move sounds (Web Audio) play without a gesture gate
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " KingsideChessApp/1.3");
        web.addJavascriptInterface(new Bridge(), "KingsideNative");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient());
        root.removeAllViews();
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    }

    private static String urlFrom(Intent i) {
        if (i == null || i.getData() == null) return null;
        Uri u = i.getData();
        if ("https".equals(u.getScheme()) && HOST.equals(u.getHost())) return u.toString();
        return null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String u = urlFrom(intent);
        if (u != null && web != null) web.loadUrl(u); // a game invite link tapped while the app is open
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onPause() { if (web != null) web.onPause(); super.onPause(); }

    @Override
    protected void onDestroy() {
        if (web != null) { root.removeView(web); web.destroy(); web = null; }
        super.onDestroy();
    }

    /* ---------------- back button ---------------- */

    private void registerBack() {
        android.window.OnBackInvokedCallback cb = this::handleBack;
        backCallback = cb;
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() { handleBack(); }

    /** Back closes whatever sheet or picker is open in the game; on the board itself, press twice to leave. */
    private void handleBack() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("(function(){try{return !!(window.__kingsideBack&&window.__kingsideBack());}catch(e){return false;}})()",
                value -> {
                    if ("true".equals(value)) return;
                    long now = System.currentTimeMillis();
                    if (now - lastBack < 2000) {
                        finish();
                    } else {
                        lastBack = now;
                        Toast.makeText(this, R.string.press_back_again, Toast.LENGTH_SHORT).show();
                    }
                });
    }

    /* ---------------- web plumbing ---------------- */

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if ("https".equals(u.getScheme()) && HOST.equals(u.getHost())) {
                String p = u.getPath();
                // the license text and other non-page files open outside; the game itself stays here
                if (p == null || p.equals("/") || p.isEmpty() || p.equals("/index.html")) return false;
            }
            openExternal(u.toString());
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost()) || !"GET".equalsIgnoreCase(req.getMethod())) return null;
            String path = u.getPath();
            if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
            if (path.startsWith("/api/")) return null; // online play: the live server
            if (path.contains("..")) return null;
            if (path.equals("/sw.js")) return notFound(); // no service worker inside the app: files are already local
            return asset("www" + path);
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // the page's renderer died (low memory): rebuild it; the game in progress is saved locally
            if (view != null) { root.removeView(view); view.destroy(); }
            createWebView();
            web.loadUrl(HOME);
            return true;
        }
    }

    private WebResourceResponse asset(String name) {
        try {
            InputStream in = getAssets().open(name);
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-cache");
            h.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse(mime(name), mime(name).startsWith("text/") || name.endsWith(".js") || name.endsWith(".mjs") || name.endsWith(".json") || name.endsWith(".webmanifest") || name.endsWith(".svg") ? "utf-8" : null,
                    200, "OK", h, in);
        } catch (IOException e) {
            return null; // not bundled (e.g. the link-preview image): let the network answer
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(),
                new java.io.ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String n) {
        n = n.toLowerCase();
        if (n.endsWith(".html")) return "text/html";
        if (n.endsWith(".js") || n.endsWith(".mjs")) return "text/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".wasm")) return "application/wasm";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".webmanifest")) return "application/manifest+json";
        if (n.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private void openExternal(String url) {
        try {
            Intent i;
            if (url.startsWith("intent:")) {
                i = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                i.setSelector(null);
            } else {
                i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException | java.net.URISyntaxException e) {
            Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show();
        }
    }

    /** What the page can ask of the phone: share sheet, clipboard, opening WhatsApp or a browser. */
    private class Bridge {
        private final Handler main = new Handler(Looper.getMainLooper());

        @JavascriptInterface
        public void share(final String text) {
            main.post(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, text);
                try { startActivity(Intent.createChooser(send, "Share game link")); }
                catch (ActivityNotFoundException e) { copy(text); }
            });
        }

        @JavascriptInterface
        public void copy(final String text) {
            main.post(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Kingside Chess link", text));
            });
        }

        @JavascriptInterface
        public void open(final String url) {
            main.post(() -> openExternal(url));
        }

        // v1.7 Share your game: a GIF (base64 from the page) to the share sheet (WhatsApp, Instagram...) or saved to Pictures
        @JavascriptInterface
        public void shareFile(final String b64, final String mime, final String name, final String text) {
            try {
                final Uri uri = FileShareProvider.write(MainActivity.this, b64, name);
                main.post(() -> {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType(mime == null || mime.isEmpty() ? "image/gif" : mime);
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
                    send.setClipData(ClipData.newRawUri(name, uri));
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try { startActivity(Intent.createChooser(send, "Share your game")); }
                    catch (ActivityNotFoundException e) { Toast.makeText(MainActivity.this, "No app to share with", Toast.LENGTH_SHORT).show(); }
                });
            } catch (Exception e) {
                main.post(() -> Toast.makeText(MainActivity.this, "Could not share the GIF", Toast.LENGTH_SHORT).show());
            }
        }

        @JavascriptInterface
        public void saveFile(final String b64, final String mime, final String name) {
            String where;
            try { where = FileShareProvider.saveToPictures(MainActivity.this, b64, mime, name); }
            catch (Exception e) { where = null; }
            final String msg = where != null ? "Saved to " + where : "Could not save the GIF";
            main.post(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
        }

        // v1.7 daily streak reminder: a local notification the phone schedules (works with the app closed)
        @JavascriptInterface
        public void setReminder(boolean on, int hour, int minute, String title, String body) {
            Reminders.save(MainActivity.this, on, hour, minute, title, body);
            Reminders.schedule(MainActivity.this);
        }

        @JavascriptInterface
        public void setStreak(String doneDay, int count, String title, String body) {
            Reminders.setStreak(MainActivity.this, doneDay, count, title, body);
        }

        @JavascriptInterface
        public String notifPermission() { return Reminders.permission(MainActivity.this); }

        @JavascriptInterface
        public void requestNotifPermission() {
            main.post(() -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    getSharedPreferences(Reminders.PREFS, MODE_PRIVATE).edit().putBoolean("asked", true).apply();
                    requestPermissions(new String[] { "android.permission.POST_NOTIFICATIONS" }, 71);
                }
            });
        }

        @JavascriptInterface
        public void testNotification(String title, String body) { Reminders.post(MainActivity.this, title, body); }

        @JavascriptInterface
        public String version() { return "1.7"; }
    }
}

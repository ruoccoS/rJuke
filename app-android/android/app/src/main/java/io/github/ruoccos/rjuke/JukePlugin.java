package io.github.ruoccos.rjuke;

import android.Manifest;
import android.content.ComponentName;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.view.HapticFeedbackConstants;
import android.view.View;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "Juke",
    permissions = {
        @Permission(alias = "audio", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class JukePlugin extends Plugin {

    private MediaController controller;
    private ListenableFuture<MediaController> controllerFuture;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final List<PluginCall> waiting = new ArrayList<>();
    private boolean visible = true;
    private Library library;

    private final Runnable progress = new Runnable() {
        @Override
        public void run() {
            if (controller != null && controller.isPlaying() && visible) {
                JSObject o = new JSObject();
                o.put("positionMs", controller.getCurrentPosition());
                o.put("durationMs", dur());
                o.put("index", controller.getCurrentMediaItemIndex());
                notifyListeners("progress", o);
            }
            main.postDelayed(this, 500);
        }
    };

    @Override
    public void load() {
        Tr.init(getContext());
        library = new Library(getContext());
        instance = this;
        main.post(this::connect);
    }

    // ===================== PartyBox da Android Auto =====================
    static volatile String pendingAuto = null;

    /** Passes a command from the car to the UI. false if the app isn't open. */
    static boolean autoCommand(String cmd) {
        JukePlugin p = instance;
        if (p == null || p.getBridge() == null) return false;
        JSObject o = new JSObject(); o.put("cmd", cmd);
        p.notifyListeners("auto", o, true);
        return true;
    }

    /** The UI reports the PartyBox state: buttons and QR code in Android Auto. */
    @PluginMethod
    public void partyAuto(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        String png = call.getString("qr", null);
        Boolean show = call.getBoolean("show", null);
        String error = call.getString("error", null);
        PlaybackService.lastPartyReply = System.currentTimeMillis();
        if (error != null && !error.isEmpty()) { PlaybackService.autoError(error); call.resolve(); return; }
        io.execute(() -> {
            try {
                File dir = new File(getContext().getFilesDir(), "covers");
                dir.mkdirs();
                File[] olds = dir.listFiles((d, n) -> n.startsWith("partyqr_"));
                if (png != null && !png.isEmpty()) {
                    if (olds != null) for (File f : olds) f.delete();
                    File f = new File(dir, "partyqr_" + System.currentTimeMillis() + ".png");
                    try (java.io.FileOutputStream fo = new java.io.FileOutputStream(f)) { fo.write(android.util.Base64.decode(png, android.util.Base64.DEFAULT)); }
                    PlaybackService.qrArt = ArtworkProvider.uriForPath(f.getAbsolutePath());
                } else if (!on) {
                    if (olds != null) for (File f : olds) f.delete();
                    PlaybackService.qrArt = null;
                }
                PlaybackService.partyOn = on;
                if (show != null) PlaybackService.partyQr = show;
                if (!on) PlaybackService.partyQr = false;
                PlaybackService.partyUpdate();
            } catch (Exception ignored) { }
            call.resolve();
        });
    }

    /** A command from the car while the app was closed. */
    @PluginMethod
    public void autoPending(PluginCall call) {
        String c = pendingAuto; pendingAuto = null;
        JSObject o = new JSObject(); o.put("cmd", c); call.resolve(o);
    }

    static JukePlugin instance;


    private void connect() {
        SessionToken token = new SessionToken(getContext(), new ComponentName(getContext(), PlaybackService.class));
        controllerFuture = new MediaController.Builder(getContext(), token).buildAsync();
        controllerFuture.addListener(() -> {
            try {
                controller = controllerFuture.get();
            } catch (Exception e) {
                return;
            }
            controller.addListener(new Player.Listener() {
                @Override
                public void onEvents(Player player, Player.Events events) {
                    emitState();
                }

                @Override
                public void onPlayerError(PlaybackException error) {
                    JSObject o = new JSObject();
                    // the real reason is in the causes of the error
                    StringBuilder m = new StringBuilder(String.valueOf(error.getMessage()));
                    Throwable c = error.getCause();
                    for (int k = 0; c != null && k < 6; k++, c = c.getCause()) m.append(" | ").append(c.getClass().getSimpleName()).append(": ").append(c.getMessage());
                    o.put("message", m.toString());
                    o.put("index", controller.getCurrentMediaItemIndex());
                    notifyListeners("error", o);
                }
            });
            for (PluginCall c : waiting) c.resolve(stateObj());
            waiting.clear();
            emitState();
            main.post(progress);
        }, ContextCompat.getMainExecutor(getContext()));
    }

    private long dur() {
        long d = controller.getDuration();
        return d == C.TIME_UNSET ? 0 : d;
    }

    private JSObject stateObj() {
        JSObject o = new JSObject();
        if (controller == null) { o.put("ready", false); return o; }
        o.put("ready", true);
        o.put("playing", controller.isPlaying());
        o.put("playWhenReady", controller.getPlayWhenReady());
        o.put("index", controller.getCurrentMediaItemIndex());
        o.put("count", controller.getMediaItemCount());
        o.put("positionMs", controller.getCurrentPosition());
        o.put("durationMs", dur());
        o.put("state", controller.getPlaybackState());
        MediaItem cur = controller.getCurrentMediaItem();
        o.put("mediaId", cur != null ? cur.mediaId : null);
        int rm = controller.getRepeatMode();
        o.put("repeat", rm == Player.REPEAT_MODE_ONE ? "one" : rm == Player.REPEAT_MODE_ALL ? "all" : "off");
        o.put("shuffle", controller.getShuffleModeEnabled());
        return o;
    }

    private void emitState() {
        notifyListeners("state", stateObj());
    }

    @Override
    protected void handleOnPause() { visible = false; }

    @Override
    protected void handleOnResume() {
        visible = true;
        if (controller != null) emitState();
    }

    @Override
    protected void handleOnDestroy() {
        main.removeCallbacks(progress);
        if (connect != null) connect.stop();
        if (controllerFuture != null) MediaController.releaseFuture(controllerFuture);
    }

    // ---------- helper ----------
    private interface Op { void run() throws Exception; }

    private void onMain(PluginCall call, Op op) {
        main.post(() -> {
            if (controller == null) { call.reject(Tr.s("Player not ready", "Player non pronto")); return; }
            try {
                op.run();
                call.resolve(stateObj());
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        });
    }

    private static MediaItem toItem(JSONObject o) throws Exception {
        MediaMetadata.Builder md = new MediaMetadata.Builder()
            .setTitle(o.optString("title"))
            .setArtist(o.optString("artist"))
            .setAlbumTitle(o.optString("album"));
        long dms = o.optLong("dur", 0);
        if (dms > 0) md.setDurationMs(dms);
        String art = o.optString("art", "");
        if (art.startsWith("http://") || art.startsWith("https://")) md.setArtworkUri(Uri.parse(art)); // another device's music (TV)
        else if (!art.isEmpty()) md.setArtworkUri(ArtworkProvider.uriForPath(art.startsWith("file://") ? Uri.parse(art).getPath() : art));
        return new MediaItem.Builder()
            .setMediaId(o.getString("id"))
            .setUri(Uri.parse(o.getString("uri")))
            .setMediaMetadata(md.build())
            .build();
    }

    private static List<MediaItem> toItems(JSONArray arr) throws Exception {
        List<MediaItem> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) out.add(toItem(arr.getJSONObject(i)));
        return out;
    }

    // ---------- playback ----------
    @PluginMethod
    public void ready(PluginCall call) {
        main.post(() -> {
            if (controller != null) call.resolve(stateObj());
            else waiting.add(call);
        });
    }

    @PluginMethod
    public void getState(PluginCall call) { onMain(call, () -> { }); }

    @PluginMethod
    public void loadQueue(PluginCall call) {
        JSArray items = call.getArray("items");
        int index = call.getInt("index", 0);
        long pos = longArg(call, "positionMs");
        boolean play = call.getBoolean("play", true);
        onMain(call, () -> {
            controller.setMediaItems(toItems(items), index, pos);
            controller.prepare();
            controller.setPlayWhenReady(play);
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        onMain(call, () -> {
            if (controller.getPlaybackState() == Player.STATE_ENDED) controller.seekTo(0);
            if (controller.getPlaybackState() == Player.STATE_IDLE) controller.prepare();
            controller.play();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) { onMain(call, () -> controller.pause()); }

    /** Capacitor reads JS numbers as Integer/Double: getLong() discarded them and returned 0 (bug #6). */
    private static long longArg(PluginCall call, String name) {
        Object v = call.getData().opt(name);
        if (v instanceof Number) return Math.max(0L, Math.round(((Number) v).doubleValue()));
        if (v instanceof String) { try { return Math.max(0L, Math.round(Double.parseDouble((String) v))); } catch (Exception ignored) { } }
        return 0L;
    }

    @PluginMethod
    public void seek(PluginCall call) {
        long ms = longArg(call, "ms");
        onMain(call, () -> controller.seekTo(ms));
    }

    @PluginMethod
    public void skipTo(PluginCall call) {
        int index = call.getInt("index", 0);
        boolean play = call.getBoolean("play", true);
        onMain(call, () -> {
            controller.seekTo(index, 0);
            if (controller.getPlaybackState() == Player.STATE_IDLE) controller.prepare();
            if (play) controller.play();
        });
    }

    @PluginMethod
    public void next(PluginCall call) { onMain(call, () -> controller.seekToNext()); }

    @PluginMethod
    public void prev(PluginCall call) { onMain(call, () -> controller.seekToPrevious()); }

    @PluginMethod
    public void setRepeat(PluginCall call) {
        String mode = call.getString("mode", "off");
        onMain(call, () -> controller.setRepeatMode(
            "one".equals(mode) ? Player.REPEAT_MODE_ONE : "all".equals(mode) ? Player.REPEAT_MODE_ALL : Player.REPEAT_MODE_OFF));
    }

    @PluginMethod
    public void insert(PluginCall call) {
        int index = call.getInt("index", 0);
        JSArray items = call.getArray("items");
        onMain(call, () -> controller.addMediaItems(Math.min(index, controller.getMediaItemCount()), toItems(items)));
    }

    @PluginMethod
    public void remove(PluginCall call) {
        int index = call.getInt("index", 0);
        int count = call.getInt("count", 1);
        onMain(call, () -> controller.removeMediaItems(index, Math.min(controller.getMediaItemCount(), index + count)));
    }

    @PluginMethod
    public void move(PluginCall call) {
        int from = call.getInt("from", 0);
        int to = call.getInt("to", 0);
        onMain(call, () -> controller.moveMediaItem(from, to));
    }

    /** Replaces all the tracks except the one playing (for gapless shuffle). */
    @PluginMethod
    public void replaceOthers(PluginCall call) {
        JSArray before = call.getArray("before");
        JSArray after = call.getArray("after");
        onMain(call, () -> {
            int idx = controller.getCurrentMediaItemIndex();
            int count = controller.getMediaItemCount();
            if (idx + 1 < count) controller.removeMediaItems(idx + 1, count);
            if (idx > 0) controller.removeMediaItems(0, idx);
            List<MediaItem> b = toItems(before);
            if (!b.isEmpty()) controller.addMediaItems(0, b);
            List<MediaItem> a = toItems(after);
            if (!a.isEmpty()) controller.addMediaItems(a);
        });
    }

    @PluginMethod
    public void setShuffle(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        onMain(call, () -> controller.setShuffleModeEnabled(on));
    }

    /** Current player queue (it may have been changed by Android Auto). */
    @PluginMethod
    public void getQueue(PluginCall call) {
        main.post(() -> {
            if (controller == null) { call.reject(Tr.s("Player not ready", "Player non pronto")); return; }
            JSArray ids = new JSArray();
            for (int i = 0; i < controller.getMediaItemCount(); i++) ids.put(controller.getMediaItemAt(i).mediaId);
            JSObject o = new JSObject();
            o.put("ids", ids);
            o.put("index", controller.getCurrentMediaItemIndex());
            o.put("shuffle", controller.getShuffleModeEnabled());
            call.resolve(o);
        });
    }

    @PluginMethod
    public void stop(PluginCall call) { onMain(call, () -> { controller.stop(); controller.clearMediaItems(); }); }

    // ---------- library ----------
    @PluginMethod
    public void info(PluginCall call) {
        JSObject o = new JSObject();
        o.put("sdk", Build.VERSION.SDK_INT);
        o.put("model", Build.MODEL);
        o.put("version", BuildConfig.VERSION_NAME);
        boolean tv = false;
        try {
            android.app.UiModeManager um = (android.app.UiModeManager) getContext().getSystemService(android.content.Context.UI_MODE_SERVICE);
            tv = (um != null && um.getCurrentModeType() == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION)
                || getContext().getPackageManager().hasSystemFeature("android.software.leanback");
        } catch (Exception ignored) { }
        o.put("tv", tv);
        call.resolve(o);
    }

    @PluginMethod
    public void folders(PluginCall call) {
        io.execute(() -> {
            try {
                JSObject o = new JSObject();
                o.put("folders", library.folders());
                call.resolve(o);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void scan(PluginCall call) {
        String root = call.getString("root", "");
        io.execute(() -> {
            try {
                JSONObject lib = library.scan(root, (phase, done, total) -> {
                    JSObject p = new JSObject();
                    p.put("phase", phase);
                    p.put("done", done);
                    p.put("total", total);
                    notifyListeners("scan", p);
                });
                JSObject o = new JSObject();
                o.put("json", lib.toString());
                call.resolve(o);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        });
    }

    @PluginMethod
    public void saveText(PluginCall call) {
        String name = call.getString("name", "");
        String text = call.getString("text", "");
        io.execute(() -> {
            try {
                if (name.contains("/") || name.isEmpty()) throw new Exception(Tr.s("Invalid name", "Nome non valido"));
                library.saveText(name, text);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void loadText(PluginCall call) {
        String name = call.getString("name", "");
        io.execute(() -> {
            try {
                if (name.contains("/") || name.isEmpty()) throw new Exception(Tr.s("Invalid name", "Nome non valido"));
                JSObject o = new JSObject();
                o.put("text", library.loadText(name));
                call.resolve(o);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    // ---------- files chosen by the user (.m3u8 playlists) ----------
    @PluginMethod
    public void pickText(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, i, "onPickText");
    }

    @ActivityCallback
    private void onPickText(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
            JSObject o = new JSObject();
            o.put("files", new JSArray());
            call.resolve(o);
            return;
        }
        Intent data = result.getData();
        List<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) {
            for (int k = 0; k < data.getClipData().getItemCount(); k++) uris.add(data.getClipData().getItemAt(k).getUri());
        } else if (data.getData() != null) uris.add(data.getData());
        io.execute(() -> {
            JSArray files = new JSArray();
            for (Uri u : uris) {
                try (InputStream in = getContext().getContentResolver().openInputStream(u)) {
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        bo.write(buf, 0, n);
                        if (bo.size() > 8 * 1024 * 1024) break;
                    }
                    JSObject f = new JSObject();
                    f.put("name", displayName(u));
                    f.put("base64", android.util.Base64.encodeToString(bo.toByteArray(), android.util.Base64.NO_WRAP));
                    files.put(f);
                } catch (Exception ignored) { }
            }
            JSObject o = new JSObject();
            o.put("files", files);
            call.resolve(o);
        });
    }

    private String displayName(Uri u) {
        try (Cursor c = getContext().getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) { }
        String s = u.getLastPathSegment();
        return s == null ? "playlist.m3u8" : s;
    }

    @PluginMethod
    public void saveDocument(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("audio/x-mpegurl");
        i.putExtra(Intent.EXTRA_TITLE, call.getString("name", "Playlist.m3u8"));
        startActivityForResult(call, i, "onSaveDocument");
    }

    @ActivityCallback
    private void onSaveDocument(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject o = new JSObject();
            o.put("saved", false);
            call.resolve(o);
            return;
        }
        Uri u = result.getData().getData();
        String text = call.getString("text", "");
        io.execute(() -> {
            try (OutputStream out = getContext().getContentResolver().openOutputStream(u, "wt")) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
                JSObject o = new JSObject();
                o.put("saved", true);
                o.put("name", displayName(u));
                call.resolve(o);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    // ---------- playlist folder (access granted once with the Android picker) ----------
    @PluginMethod
    public void pickTree(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "onPickTree");
    }

    @ActivityCallback
    private void onPickTree(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject o = new JSObject();
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(o);
            return;
        }
        Uri u = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) { }
        o.put("uri", u.toString());
        String id = DocumentsContract.getTreeDocumentId(u);
        String name = id;
        int k = id.lastIndexOf(':');
        if (k >= 0) name = id.substring(k + 1);
        if (name.isEmpty()) name = Tr.s("Internal storage", "Memoria interna");
        o.put("name", name);
        call.resolve(o);
    }

    @PluginMethod
    public void findPlaylists(PluginCall call) {
        String uri = call.getString("uri", "");
        io.execute(() -> {
            try {
                Uri tree = Uri.parse(uri);
                JSArray files = new JSArray();
                walkTree(tree, DocumentsContract.getTreeDocumentId(tree), 0, files);
                JSObject o = new JSObject();
                o.put("files", files);
                call.resolve(o);
            } catch (SecurityException e) {
                call.reject("no-access");
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        });
    }

    private void walkTree(Uri tree, String docId, int depth, JSArray out) throws Exception {
        if (depth > 10 || out.length() >= 300) return;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
        String[] cols = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_SIZE,
        };
        List<String> dirs = new ArrayList<>();
        try (Cursor c = getContext().getContentResolver().query(children, cols, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                String id = c.getString(0), name = c.getString(1), mime = c.getString(2);
                if (name == null || name.startsWith(".")) continue;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) { dirs.add(id); continue; }
                String low = name.toLowerCase(java.util.Locale.ROOT);
                if (!low.endsWith(".m3u8") && !low.endsWith(".m3u")) continue;
                if (c.getLong(4) > 8L * 1024 * 1024) continue;
                Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, id);
                try (InputStream in = getContext().getContentResolver().openInputStream(doc)) {
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                    JSObject f = new JSObject();
                    f.put("name", name);
                    f.put("uri", doc.toString());
                    f.put("mtime", c.getLong(3));
                    f.put("base64", android.util.Base64.encodeToString(bo.toByteArray(), android.util.Base64.NO_WRAP));
                    out.put(f);
                } catch (Exception ignored) { }
            }
        }
        for (String d : dirs) walkTree(tree, d, depth + 1, out);
    }

    // ---------- rJuke Connect ----------
    private Connect connect;

    // library for the “speaker” PC: copied into the native server, which answers even with the screen locked (bug #50)
    private String pendingShare = null;
    @PluginMethod
    public void libShare(PluginCall call) {
        String data = call.getString("data", null);
        if (data == null) { call.resolve(); return; }
        if (connect == null) { pendingShare = data; call.resolve(); return; }
        connect.async(() -> { connect.setShare(data); call.resolve(); });
    }

    // ---------- TV using another device's music: tracks kept in a fixed 1 GB cache ----------
    private static final long PC_LIMIT = 1024L * 1024 * 1024;
    private final ExecutorService pcPool = Executors.newFixedThreadPool(2);
    private final java.util.concurrent.ConcurrentHashMap<String, java.util.concurrent.CompletableFuture<String>> pcInflight = new java.util.concurrent.ConcurrentHashMap<>();
    private JSONObject pcIndex = null;
    private synchronized JSONObject pcIdx() {
        if (pcIndex == null) {
            try {
                java.io.File f = new java.io.File(getContext().getFilesDir(), "phone-cache.json");
                pcIndex = f.exists() ? new JSONObject(new String(java.nio.file.Files.readAllBytes(f.toPath()), java.nio.charset.StandardCharsets.UTF_8)) : new JSONObject();
            } catch (Exception e) { pcIndex = new JSONObject(); }
            for (java.util.Iterator<String> it = pcIndex.keys(); it.hasNext(); ) {
                JSONObject v = pcIndex.optJSONObject(it.next());
                if (v == null || !new java.io.File(v.optString("file")).exists()) it.remove();
            }
        }
        return pcIndex;
    }
    private synchronized void pcSave() {
        try (java.io.FileOutputStream fo = new java.io.FileOutputStream(new java.io.File(getContext().getFilesDir(), "phone-cache.json"))) {
            fo.write(pcIdx().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        } catch (Exception ignored) { }
    }
    private synchronized void pcTrim(String keep) {
        JSONObject idx = pcIdx();
        long total = 0;
        List<String> keys = new ArrayList<>();
        for (java.util.Iterator<String> it = idx.keys(); it.hasNext(); ) { String k = it.next(); keys.add(k); total += idx.optJSONObject(k).optLong("size"); }
        if (total <= PC_LIMIT) return;
        keys.sort((a, b) -> Long.compare(idx.optJSONObject(a).optLong("at"), idx.optJSONObject(b).optLong("at")));
        for (String k : keys) {
            if (total <= PC_LIMIT) break;
            if (k.equals(keep)) continue;
            JSONObject v = idx.optJSONObject(k);
            new java.io.File(v.optString("file")).delete();
            total -= v.optLong("size");
            idx.remove(k);
        }
        pcSave();
    }
    private String pcDownload(String url, String key, String ext) {
        try {
            java.io.File dir = new java.io.File(getContext().getCacheDir(), "phone-cache");
            dir.mkdirs();
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-1");
            StringBuilder hx = new StringBuilder();
            for (byte b : md.digest(key.getBytes(java.nio.charset.StandardCharsets.UTF_8))) hx.append(String.format("%02x", b));
            java.io.File dest = new java.io.File(dir, hx + "." + ext.replaceAll("[^a-zA-Z0-9]", ""));
            java.io.File tmp = new java.io.File(dir, dest.getName() + ".part");
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
            c.setConnectTimeout(5000); c.setReadTimeout(15000);
            if (c.getResponseCode() != 200) { c.disconnect(); return null; }
            try (java.io.InputStream in = c.getInputStream(); java.io.FileOutputStream fo = new java.io.FileOutputStream(tmp)) {
                byte[] buf = new byte[65536]; int n;
                while ((n = in.read(buf)) > 0) fo.write(buf, 0, n);
            } finally { c.disconnect(); }
            if (!tmp.renameTo(dest)) { tmp.delete(); return null; }
            synchronized (this) {
                JSONObject v = new JSONObject();
                v.put("file", dest.getAbsolutePath()); v.put("size", dest.length()); v.put("at", System.currentTimeMillis());
                pcIdx().put(key, v);
                pcSave();
            }
            pcTrim(key);
            return dest.getAbsolutePath();
        } catch (Exception e) { return null; }
    }
    @PluginMethod
    public void pcacheFetch(PluginCall call) {
        String url = call.getString("url", ""), key = call.getString("key", ""), ext = call.getString("ext", "bin");
        synchronized (this) {
            JSONObject v = pcIdx().optJSONObject(key);
            if (v != null && new java.io.File(v.optString("file")).exists()) {
                try { v.put("at", System.currentTimeMillis()); } catch (Exception ignored) { }
                pcSave();
                JSObject o = new JSObject(); o.put("file", v.optString("file")); call.resolve(o); return;
            }
        }
        java.util.concurrent.CompletableFuture<String> f = pcInflight.computeIfAbsent(key, k -> java.util.concurrent.CompletableFuture.supplyAsync(() -> pcDownload(url, key, ext), pcPool));
        f.whenComplete((file, err) -> { pcInflight.remove(key); JSObject o = new JSObject(); o.put("file", file); call.resolve(o); });
    }
    @PluginMethod
    public synchronized void pcacheList(PluginCall call) {
        JSObject out = new JSObject();
        JSONObject idx = pcIdx();
        for (java.util.Iterator<String> it = idx.keys(); it.hasNext(); ) { String k = it.next(); out.put(k, idx.optJSONObject(k).optString("file")); }
        JSObject o = new JSObject(); o.put("map", out); call.resolve(o);
    }
    @PluginMethod
    public synchronized void pcacheStats(PluginCall call) {
        JSONObject idx = pcIdx();
        long bytes = 0; int count = 0;
        for (java.util.Iterator<String> it = idx.keys(); it.hasNext(); ) { bytes += idx.optJSONObject(it.next()).optLong("size"); count++; }
        JSObject o = new JSObject(); o.put("count", count); o.put("bytes", bytes); call.resolve(o);
    }
    @PluginMethod
    public synchronized void pcacheClear(PluginCall call) {
        JSONObject idx = pcIdx();
        for (java.util.Iterator<String> it = idx.keys(); it.hasNext(); ) new java.io.File(idx.optJSONObject(it.next()).optString("file")).delete();
        pcIndex = new JSONObject(); pcSave();
        call.resolve();
    }

    // ---------- TV: the other device's covers downloaded natively and kept on disk ----------
    // (the WebView must not load http images: some TVs block them; this way they also load instantly next time)
    private static final long CV_LIMIT = 300L * 1024 * 1024;
    private final ExecutorService cvPool = Executors.newFixedThreadPool(3);
    private final java.util.concurrent.ConcurrentHashMap<String, java.util.concurrent.CompletableFuture<String>> cvInflight = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.concurrent.atomic.AtomicInteger cvAdded = new java.util.concurrent.atomic.AtomicInteger();
    private java.io.File cvFile(String key) throws Exception {
        java.io.File dir = new java.io.File(getContext().getCacheDir(), "remote-covers");
        dir.mkdirs();
        java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-1");
        StringBuilder hx = new StringBuilder();
        for (byte b : md.digest(key.getBytes(java.nio.charset.StandardCharsets.UTF_8))) hx.append(String.format("%02x", b));
        return new java.io.File(dir, hx + ".jpg");
    }
    @PluginMethod
    public void coverGet(PluginCall call) {
        String url = call.getString("url", ""), key = call.getString("key", url);
        try {
            java.io.File f = cvFile(key);
            if (f.exists() && f.length() > 0) { JSObject o = new JSObject(); o.put("file", f.getAbsolutePath()); call.resolve(o); return; }
        } catch (Exception ignored) { }
        boolean cachedOnly = call.getBoolean("cachedOnly", false);
        if (cachedOnly || url.isEmpty()) { JSObject o = new JSObject(); o.put("file", (String) null); call.resolve(o); return; }
        java.util.concurrent.CompletableFuture<String> fut = cvInflight.computeIfAbsent(key, k -> java.util.concurrent.CompletableFuture.supplyAsync(() -> cvDownload(url, key), cvPool));
        fut.whenComplete((file, err) -> { cvInflight.remove(key); JSObject o = new JSObject(); o.put("file", file); call.resolve(o); });
    }
    private String cvDownload(String url, String key) {
        java.net.HttpURLConnection c = null;
        try {
            java.io.File dest = cvFile(key);
            java.io.File tmp = new java.io.File(dest.getParentFile(), dest.getName() + "." + Thread.currentThread().getId() + ".part");
            c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
            c.setConnectTimeout(4000); c.setReadTimeout(8000);
            if (c.getResponseCode() != 200) return null;
            try (java.io.InputStream in = c.getInputStream(); java.io.FileOutputStream fo = new java.io.FileOutputStream(tmp)) {
                byte[] buf = new byte[32768]; int n;
                while ((n = in.read(buf)) > 0) fo.write(buf, 0, n);
            }
            if (tmp.length() == 0 || !tmp.renameTo(dest)) { tmp.delete(); return null; }
            if (cvAdded.incrementAndGet() % 40 == 0) cvTrim();
            return dest.getAbsolutePath();
        } catch (Exception e) { return null; }
        finally { if (c != null) c.disconnect(); }
    }
    private void cvTrim() {
        try {
            java.io.File[] fs = new java.io.File(getContext().getCacheDir(), "remote-covers").listFiles();
            if (fs == null) return;
            long tot = 0; for (java.io.File f : fs) tot += f.length();
            if (tot <= CV_LIMIT) return;
            java.util.Arrays.sort(fs, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
            for (java.io.File f : fs) { if (tot <= CV_LIMIT * 0.8) break; tot -= f.length(); f.delete(); }
        } catch (Exception ignored) { }
    }

    // battery saver: to serve the PC with the screen locked the app must not be restricted
    @PluginMethod
    public void batteryStatus(PluginCall call) {
        JSObject o = new JSObject();
        boolean ok = true;
        try {
            android.os.PowerManager pm = (android.os.PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
            ok = pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        } catch (Exception ignored) { }
        o.put("exempt", ok);
        call.resolve(o);
    }
    @PluginMethod
    public void batteryExempt(PluginCall call) {
        try {
            android.content.Intent i = new android.content.Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            try {
                android.content.Intent i = new android.content.Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            } catch (Exception ignored) { }
        }
        call.resolve();
    }

    @PluginMethod
    public void connectStart(PluginCall call) {
        String id = call.getString("id", "");
        String name = call.getString("name", "Telefono");
        if (connect == null) connect = new Connect(getContext(), new Connect.Listener() {
            public void onRequest(JSONObject req) {
                try { notifyListeners("connectRequest", JSObject.fromJSONObject(req)); } catch (Exception ignored) { }
            }
            public void onDevices(JSONArray devices) {
                JSObject o = new JSObject();
                o.put("devices", devices);
                notifyListeners("connectDevices", o);
            }
        });
        if (pendingShare != null) { connect.setShare(pendingShare); pendingShare = null; }
        String icon = call.getString("icon", "");
        connect.async(() -> {
            try { call.resolve(JSObject.fromJSONObject(connect.start(id, name, icon))); }
            catch (Exception e) { call.reject(e.getMessage() != null ? e.getMessage() : e.toString()); }
        });
    }

    @PluginMethod
    public void connectScan(PluginCall call) {
        if (connect == null) { call.resolve(); return; }
        connect.async(() -> { connect.scan(); call.resolve(); });
    }

    @PluginMethod
    public void partyServe(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        if (connect == null) { call.reject(Tr.s("Connect isn't running", "Connect non avviato")); return; }
        if (on) connect.partyPage(call.getString("token", ""), call.getString("page"), call.getString("ended"));
        connect.async(() -> {
            int port = connect.partyServe(on);
            if (on && port == 0) { call.reject(Tr.s("No free port for PartyBox", "Nessuna porta libera per PartyBox")); return; }
            JSObject o = new JSObject();
            o.put("port", port);
            call.resolve(o);
        });
    }

    @PluginMethod
    public void partyStats(PluginCall call) {
        JSObject o = new JSObject();
        if (connect != null) {
            if (Boolean.TRUE.equals(call.getBoolean("reset", false))) connect.pbReset();
            o.put("conn", connect.pbConn.get()); o.put("tls", connect.pbTls.get()); o.put("empty", connect.pbEmpty.get());
            o.put("page", connect.pbPage.get()); o.put("api", connect.pbApi.get()); o.put("err", connect.pbErr.get());
            o.put("lastErr", connect.pbLastErr); o.put("from", connect.pbLastFrom); o.put("port", connect.partyPort);
        }
        call.resolve(o);
    }

    @PluginMethod
    public void connectIps(PluginCall call) {
        JSObject o = new JSObject();
        o.put("ips", Connect.allIps());
        call.resolve(o);
    }

    @PluginMethod
    public void connectRespond(PluginCall call) {
        if (connect == null) { call.resolve(); return; }
        try {
            JSONObject r = new JSONObject();
            r.put("status", call.getInt("status", 200));
            if (call.getString("stream") != null) { r.put("stream", call.getString("stream")); r.put("type", call.getString("type", "application/octet-stream")); }
            else if (call.getString("file") != null) { r.put("file", call.getString("file")); r.put("type", call.getString("type", "image/jpeg")); r.put("cache", Boolean.TRUE.equals(call.getBoolean("cache", false))); }
            else if (call.getString("text") != null) { r.put("text", call.getString("text")); r.put("type", call.getString("type", "text/html; charset=utf-8")); }
            else r.put("body", call.getString("body", "{}"));
            connect.respond(call.getInt("id", 0), r);
        } catch (Exception ignored) { }
        call.resolve();
    }

    @PluginMethod
    public void connectFetch(PluginCall call) {
        if (connect == null) { call.reject(Tr.s("Connect isn't running", "Connect non avviato")); return; }
        String host = call.getString("host", "");
        int port = call.getInt("port", 47123);
        String path = call.getString("path", "/");
        String method = call.getString("method", "GET");
        String body = call.getString("body", null);
        boolean binary = call.getBoolean("binary", false);
        int timeout = call.getInt("timeout", 8000);
        connect.async(() -> {
            try { call.resolve(JSObject.fromJSONObject(connect.fetch(host, port, path, method, body, binary, timeout))); }
            catch (Exception e) { call.reject(e.getMessage() != null ? e.getMessage() : e.toString()); }
        });
    }

    // ---------- small touches ----------
    @PluginMethod
    public void haptic(PluginCall call) {
        String kind = call.getString("kind", "tick");
        main.post(() -> {
            View v = getBridge().getWebView();
            int c = HapticFeedbackConstants.CLOCK_TICK;
            if ("confirm".equals(kind) && Build.VERSION.SDK_INT >= 30) c = HapticFeedbackConstants.CONFIRM;
            else if ("long".equals(kind)) c = HapticFeedbackConstants.LONG_PRESS;
            else if ("tap".equals(kind)) c = HapticFeedbackConstants.KEYBOARD_TAP;
            v.performHapticFeedback(c);
            call.resolve();
        });
    }

    // “Do you want to exit the app?” on the TV: I stop the music and really close the app
    @PluginMethod
    public void exitApp(PluginCall call) {
        main.post(() -> {
            try { if (controller != null) controller.pause(); } catch (Exception ignored) { }
            try { if (connect != null) connect.partyServe(false); } catch (Exception ignored) { }
            try { getContext().stopService(new Intent(getContext(), PlaybackService.class)); } catch (Exception ignored) { }
            call.resolve();
            try { getActivity().finishAndRemoveTask(); } catch (Exception e) { getActivity().finish(); }
        });
    }

    @PluginMethod
    public void moveToBack(PluginCall call) {
        main.post(() -> {
            getActivity().moveTaskToBack(true);
            call.resolve();
        });
    }
}

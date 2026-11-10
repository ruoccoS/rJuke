package io.github.ruoccos.rjuke;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.Enumeration;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * rJuke Connect: a small server on the home network + automatic discovery of other devices
 * (mDNS/NSD). Requests are passed to the UI, which knows the player state and the library.
 */
public class Connect {

    public interface Listener {
        void onRequest(JSONObject req);
        void onDevices(JSONArray devices);
    }

    static final String TYPE = "_rjuke._tcp";   // neutral: rJuke and rJuke see each other
    private final Context ctx;
    private final Listener listener;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<Integer, CompletableFuture<JSONObject>> pending = new ConcurrentHashMap<>();
    private final AtomicInteger seq = new AtomicInteger();
    private final Map<String, JSONObject> devices = new ConcurrentHashMap<>();
    private final ArrayDeque<NsdServiceInfo> resolveQueue = new ArrayDeque<>();
    private boolean resolving = false;
    private ServerSocket server;
    private NsdManager nsd;
    private NsdManager.RegistrationListener regListener;
    private NsdManager.DiscoveryListener discListener;
    private WifiManager.MulticastLock lock;
    private String myId = "", myName = "", registeredName = "";
    /** icon chosen in settings (“” = automatic) */
    private volatile String myIcon = "";
    int port = 0;

    Connect(Context ctx, Listener l) { this.ctx = ctx.getApplicationContext(); this.listener = l; loadShare(); isTv = detectTv(this.ctx); }
    /** true on Android TV: other devices show it with the TV icon */
    final boolean isTv;
    static boolean detectTv(Context c) {
        try {
            android.app.UiModeManager um = (android.app.UiModeManager) c.getSystemService(Context.UI_MODE_SERVICE);
            return (um != null && um.getCurrentModeType() == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION)
                || c.getPackageManager().hasSystemFeature("android.software.leanback");
        } catch (Exception e) { return false; }
    }

    // ---------- library shared with a “speaker” PC, served without going through the UI (bug #50) ----------
    // with the screen locked the UI (WebView) falls asleep: this class serves the list, tracks and covers directly
    private static final class Share {
        String name = "", platform = "android", version = "", stamp = "", body = "{}";
        final Map<String, String> devTokens = new ConcurrentHashMap<>();   // device → code
        final Map<String, String> devNames = new ConcurrentHashMap<>();
        final java.util.Set<String> tokens = ConcurrentHashMap.newKeySet();
        final Map<String, String[]> files = new ConcurrentHashMap<>();     // path → [uri, type]
        final Map<String, String[]> covers = new ConcurrentHashMap<>();    // album → [small, large]
    }
    private volatile Share share = null;

    void setShare(String json) {
        try {
            Share sh = parseShare(json);
            share = sh;
            try (java.io.FileOutputStream fo = new java.io.FileOutputStream(new File(ctx.getFilesDir(), "libshare.json"))) { fo.write(json.getBytes(StandardCharsets.UTF_8)); }
        } catch (Exception ignored) { }
    }
    private void loadShare() {
        try {
            File f = new File(ctx.getFilesDir(), "libshare.json");
            if (f.exists()) share = parseShare(new String(java.nio.file.Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
        } catch (Exception ignored) { }
    }
    private static Share parseShare(String json) throws Exception {
        JSONObject o = new JSONObject(json);
        Share sh = new Share();
        sh.name = o.optString("name"); sh.platform = o.optString("platform", "android"); sh.version = o.optString("version");
        sh.stamp = o.optString("stamp"); sh.body = o.optString("body", "{}");
        JSONObject dt = o.optJSONObject("devTokens");
        if (dt != null) for (java.util.Iterator<String> it = dt.keys(); it.hasNext(); ) { String k = it.next(); String t = dt.optString(k); if (!t.isEmpty()) { sh.devTokens.put(k, t); sh.tokens.add(t); } }
        JSONObject dn = o.optJSONObject("devNames");
        if (dn != null) for (java.util.Iterator<String> it = dn.keys(); it.hasNext(); ) { String k = it.next(); sh.devNames.put(k, dn.optString(k)); }
        JSONArray fl = o.optJSONArray("files");
        if (fl != null) for (int i = 0; i < fl.length(); i++) { JSONArray a = fl.optJSONArray(i); if (a != null && a.length() >= 3) sh.files.put(a.optString(0), new String[] { a.optString(1), a.optString(2) }); }
        JSONArray cv = o.optJSONArray("covers");
        if (cv != null) for (int i = 0; i < cv.length(); i++) { JSONArray a = cv.optJSONArray(i); if (a != null && a.length() >= 3) sh.covers.put(a.optString(0), new String[] { a.optString(1), a.optString(2) }); }
        return sh;
    }
    static Map<String, String> query(String path) {
        Map<String, String> q = new java.util.HashMap<>();
        int i = path.indexOf('?');
        if (i < 0) return q;
        for (String kv : path.substring(i + 1).split("&")) {
            int e = kv.indexOf('=');
            try {
                if (e < 0) q.put(java.net.URLDecoder.decode(kv, "UTF-8"), "");
                else q.put(java.net.URLDecoder.decode(kv.substring(0, e), "UTF-8"), java.net.URLDecoder.decode(kv.substring(e + 1), "UTF-8"));
            } catch (Exception ignored) { }
        }
        return q;
    }
    private String tokenOwner(Share sh, String tok) {
        for (Map.Entry<String, String> e : sh.devTokens.entrySet()) if (e.getValue().equals(tok)) return sh.devNames.containsKey(e.getKey()) ? sh.devNames.get(e.getKey()) : "";
        return "";
    }
    /** true if the request was served here; false if it must go to the UI. */
    private boolean serveNative(OutputStream out, String method, String path, String devId, String devName, String range) throws Exception {
        String p = path.indexOf('?') >= 0 ? path.substring(0, path.indexOf('?')) : path;
        if (p.equals("/rj/info")) {
            Share sh = share;
            JSONObject o = new JSONObject();
            o.put("id", myId); o.put("name", myName); o.put("platform", "android"); o.put("tv", isTv); o.put("icon", myIcon); o.put("version", sh != null ? sh.version : "");
            write(out, 200, "application/json; charset=utf-8", o.toString().getBytes(StandardCharsets.UTF_8));
            return true;
        }
        if (!p.startsWith("/rj/lib/")) return false;
        Share sh = share;
        if (sh == null) return false;
        Map<String, String> q = query(path);
        switch (p) {
            case "/rj/lib/index": {
                String tok = sh.devTokens.get(devId);
                if (devId.isEmpty() || tok == null) return false; // first connection: the UI decides (asks for permission)
                ShareService.touch(ctx, devName.isEmpty() ? sh.devNames.get(devId) : devName);
                JSONObject head = new JSONObject();
                head.put("name", sh.name.isEmpty() ? myName : sh.name); head.put("platform", sh.platform); head.put("stamp", sh.stamp); head.put("token", tok);
                String since = q.containsKey("since") ? q.get("since") : "";
                String text;
                if (!since.isEmpty() && since.equals(sh.stamp)) { head.put("same", true); text = head.toString(); }
                else {
                    String h = head.toString();
                    String b = sh.body.trim();
                    text = b.length() > 2 ? h.substring(0, h.length() - 1) + "," + b.substring(1) : h;
                }
                write(out, 200, "application/json; charset=utf-8", text.getBytes(StandardCharsets.UTF_8));
                return true;
            }
            case "/rj/lib/file": {
                String tok = q.containsKey("t") ? q.get("t") : "";
                if (tok.isEmpty() || !sh.tokens.contains(tok)) { write(out, 403, "application/json", "{\"error\":\"invalid code\"}".getBytes(StandardCharsets.UTF_8)); return true; }
                String[] f = sh.files.get(q.containsKey("p") ? q.get("p") : "");
                if (f == null) return false; // track just added: the UI may already know it
                ShareService.touch(ctx, tokenOwner(sh, tok));
                streamUri(out, f[0], f[1], range, "HEAD".equals(method));
                return true;
            }
            case "/rj/lib/cover": {
                String tok = q.containsKey("t") ? q.get("t") : "";
                if (tok.isEmpty() || !sh.tokens.contains(tok)) { write(out, 403, "application/json", "{\"error\":\"invalid code\"}".getBytes(StandardCharsets.UTF_8)); return true; }
                String[] c = sh.covers.get(q.containsKey("a") ? q.get("a") : "");
                if (c == null) { write(out, 404, "application/json", "{}".getBytes(StandardCharsets.UTF_8)); return true; }
                File file = new File("l".equals(q.get("size")) ? c[1] : c[0]);
                if (!file.exists()) { write(out, 404, "application/json", "{}".getBytes(StandardCharsets.UTF_8)); return true; }
                byte[] data = java.nio.file.Files.readAllBytes(file.toPath());
                String hd = "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nContent-Length: " + data.length
                    + "\r\nCache-Control: max-age=604800\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n";
                out.write(hd.getBytes(StandardCharsets.UTF_8));
                if (!"HEAD".equals(method)) out.write(data);
                out.flush();
                return true;
            }
            default: return false; // lyrics: read by the UI
        }
    }

    // ---------- startup ----------
    synchronized JSONObject start(String id, String name) throws Exception { return start(id, name, myIcon); }
    synchronized JSONObject start(String id, String name, String icon) throws Exception {
        myId = id; myName = name; myIcon = icon == null ? "" : icon;
        if (server == null) {
            for (int p = 47123; p <= 47135 && server == null; p++) {
                try { ServerSocket s = new ServerSocket(); s.setReuseAddress(true); s.bind(new InetSocketAddress(p)); server = s; port = p; } catch (Exception ignored) { }
            }
            if (server == null) throw new Exception(Tr.s("No free port", "Nessuna porta libera"));
            acceptLoop(server, false);
        }
        nsd = (NsdManager) ctx.getSystemService(Context.NSD_SERVICE);
        register();
        discover();
        JSONObject o = new JSONObject();
        o.put("ip", localIp());
        o.put("port", port);
        return o;
    }

    private void acceptLoop(final ServerSocket s, final boolean party) {
        pool.execute(() -> {
            while (!s.isClosed()) {
                try { Socket c = s.accept(); pool.execute(() -> handle(c, party)); } catch (Exception e) { if (s.isClosed()) break; }
            }
        });
    }

    // ---------- PartyBox: dedicated server, on only during the party ----------
    private ServerSocket partyServer;
    int partyPort = 0;
    // PartyBox diagnostics: what really arrives from the phones
    final java.util.concurrent.atomic.AtomicInteger pbConn = new java.util.concurrent.atomic.AtomicInteger(), pbTls = new java.util.concurrent.atomic.AtomicInteger(),
        pbEmpty = new java.util.concurrent.atomic.AtomicInteger(), pbPage = new java.util.concurrent.atomic.AtomicInteger(), pbApi = new java.util.concurrent.atomic.AtomicInteger(),
        pbErr = new java.util.concurrent.atomic.AtomicInteger();
    volatile String pbLastErr = "", pbLastFrom = "";
    void pbReset() { pbConn.set(0); pbTls.set(0); pbEmpty.set(0); pbPage.set(0); pbApi.set(0); pbErr.set(0); pbLastErr = ""; pbLastFrom = ""; }
    // guest page kept in memory: it opens even if the app UI is paused
    private volatile String partyToken = "", partyPage = null, partyEndedPage = null;
    void partyPage(String token, String page, String ended) { partyToken = token == null ? "" : token; if (page != null) partyPage = page; if (ended != null) partyEndedPage = ended; }
    synchronized int partyServe(boolean on) {
        if (!on) {
            partyToken = "";
            if (partyServer != null) { try { partyServer.close(); } catch (Exception ignored) { } }
            partyServer = null; partyPort = 0;
            return 0;
        }
        if (partyServer != null) return partyPort;
        for (int p = 47150; p <= 47170 && partyServer == null; p++) {
            try { ServerSocket s = new ServerSocket(); s.setReuseAddress(true); s.bind(new InetSocketAddress(p)); partyServer = s; partyPort = p; } catch (Exception ignored) { }
        }
        if (partyServer == null) return 0;
        acceptLoop(partyServer, true);
        return partyPort;
    }

    private void register() {
        try { if (regListener != null) nsd.unregisterService(regListener); } catch (Exception ignored) { }
        NsdServiceInfo info = new NsdServiceInfo();
        info.setServiceName(myName + " · " + myId.substring(0, Math.min(4, myId.length())));
        info.setServiceType(TYPE);
        info.setPort(port);
        info.setAttribute("id", myId);
        info.setAttribute("name", myName);
        info.setAttribute("platform", "android");
        if (isTv) info.setAttribute("tv", "1");
        if (!myIcon.isEmpty()) info.setAttribute("icon", myIcon);
        regListener = new NsdManager.RegistrationListener() {
            public void onServiceRegistered(NsdServiceInfo i) { registeredName = i.getServiceName(); }
            public void onRegistrationFailed(NsdServiceInfo i, int e) { }
            public void onServiceUnregistered(NsdServiceInfo i) { }
            public void onUnregistrationFailed(NsdServiceInfo i, int e) { }
        };
        nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, regListener);
    }

    private void discover() {
        if (discListener != null) return;
        try {
            WifiManager wm = (WifiManager) ctx.getSystemService(Context.WIFI_SERVICE);
            lock = wm.createMulticastLock("rjuke-connect");
            lock.setReferenceCounted(false);
            lock.acquire();
        } catch (Exception ignored) { }
        discListener = new NsdManager.DiscoveryListener() {
            public void onDiscoveryStarted(String t) { }
            public void onDiscoveryStopped(String t) { }
            public void onStartDiscoveryFailed(String t, int e) { discListener = null; }
            public void onStopDiscoveryFailed(String t, int e) { }
            public void onServiceFound(NsdServiceInfo s) {
                if (s.getServiceName().equals(registeredName)) return;
                synchronized (resolveQueue) { resolveQueue.add(s); }
                nextResolve();
            }
            public void onServiceLost(NsdServiceInfo s) {
                for (Map.Entry<String, JSONObject> e : devices.entrySet()) {
                    if (s.getServiceName().equals(e.getValue().optString("service"))) devices.remove(e.getKey());
                }
                emitDevices();
            }
        };
        nsd.discoverServices(TYPE, NsdManager.PROTOCOL_DNS_SD, discListener);
    }

    @SuppressWarnings("deprecation")
    private void nextResolve() {
        NsdServiceInfo s;
        synchronized (resolveQueue) {
            if (resolving || resolveQueue.isEmpty()) return;
            resolving = true;
            s = resolveQueue.poll();
        }
        nsd.resolveService(s, new NsdManager.ResolveListener() {
            public void onResolveFailed(NsdServiceInfo i, int e) { done(); }
            public void onServiceResolved(NsdServiceInfo i) {
                try {
                    Map<String, byte[]> a = i.getAttributes();
                    String id = a.containsKey("id") ? new String(a.get("id"), StandardCharsets.UTF_8) : i.getServiceName();
                    if (!id.equals(myId) && i.getHost() != null) {
                        JSONObject d = new JSONObject();
                        d.put("id", id);
                        d.put("name", a.containsKey("name") ? new String(a.get("name"), StandardCharsets.UTF_8) : i.getServiceName());
                        d.put("platform", a.containsKey("platform") ? new String(a.get("platform"), StandardCharsets.UTF_8) : "");
                        d.put("tv", a.containsKey("tv") && "1".equals(new String(a.get("tv"), StandardCharsets.UTF_8)));
                        d.put("icon", a.containsKey("icon") && a.get("icon") != null ? new String(a.get("icon"), StandardCharsets.UTF_8) : "");
                        d.put("host", i.getHost().getHostAddress());
                        d.put("port", i.getPort());
                        d.put("service", i.getServiceName());
                        devices.put(id, d);
                        emitDevices();
                    }
                } catch (Exception ignored) { }
                done();
            }
            private void done() { synchronized (resolveQueue) { resolving = false; } nextResolve(); }
        });
    }

    private void emitDevices() {
        JSONArray arr = new JSONArray();
        for (JSONObject d : devices.values()) arr.put(d);
        listener.onDevices(arr);
    }

    synchronized void stop() {
        partyServe(false);
        try { if (discListener != null) nsd.stopServiceDiscovery(discListener); } catch (Exception ignored) { }
        try { if (regListener != null) nsd.unregisterService(regListener); } catch (Exception ignored) { }
        try { if (server != null) server.close(); } catch (Exception ignored) { }
        try { if (lock != null) lock.release(); } catch (Exception ignored) { }
        discListener = null; regListener = null; server = null;
    }

    // ---------- server ----------
    private static boolean isPrivate(InetAddress a) {
        return a.isSiteLocalAddress() || a.isLoopbackAddress() || a.isLinkLocalAddress()
            || (a.getAddress().length == 4 && (a.getAddress()[0] & 0xff) == 100 && ((a.getAddress()[1] & 0xff) & 0xC0) == 64);
    }


    private void handle(Socket c, boolean party) {
        Socket sock = c;
        try {
            // browsers open “spare” connections that wait idle: if we closed them too early,
            // when they are used the phone would get an empty response (ERR_TOO_MANY_RETRIES on Chrome)
            sock.setSoTimeout(party ? 120000 : 8000);
            sock.setTcpNoDelay(true);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            OutputStream out = sock.getOutputStream();
            // a browser that tries HTTPS first (Safari, Chrome) sends a TLS “ClientHello” (first byte 0x16):
            // must be closed right away, so it falls back to HTTP instead of hanging until the timeout (bug #30)
            in.mark(1);
            if (party) { pbConn.incrementAndGet(); pbLastFrom = String.valueOf(sock.getInetAddress()); }
            int first = in.read();
            if (first < 0) { if (party) pbEmpty.incrementAndGet(); return; }
            if (first == 0x16 || first == 0x80) { if (party) pbTls.incrementAndGet(); return; }
            in.reset();
            sock.setSoTimeout(8000);
            if (!isPrivate(sock.getInetAddress())) { write(out, 403, "application/json", "{\"error\":\"not a private network\"}".getBytes(StandardCharsets.UTF_8)); return; }
            String line = readLine(in);
            if (line == null) return;
            String[] parts = line.split(" ");
            if (parts.length < 2) return;
            String method = parts[0], path = parts[1];
            int len = 0;
            String devId = "", devName = "", range = "";
            String h;
            while ((h = readLine(in)) != null && !h.isEmpty()) {
                int k = h.indexOf(':'); if (k < 0) continue;
                String name = h.substring(0, k).trim().toLowerCase(java.util.Locale.ROOT), val = h.substring(k + 1).trim();
                if (name.equals("content-length")) len = Math.min(4 * 1024 * 1024, Integer.parseInt(val));
                else if (name.equals("x-rj-id")) devId = val;
                else if (name.equals("x-rj-name")) devName = java.net.URLDecoder.decode(val, "UTF-8");
                else if (name.equals("range")) range = val;
            }
            byte[] body = new byte[len];
            int r = 0;
            while (r < len) { int n = in.read(body, r, len - r); if (n < 0) break; r += n; }
            if ("OPTIONS".equals(method)) { write(out, 204, "text/plain", new byte[0]); return; }
            if (party && (path.equals("/favicon.ico") || path.startsWith("/apple-touch-icon"))) { write(out, 204, "image/png", new byte[0]); return; }
            if (party && "GET".equals(method) && (path.equals("/party") || path.startsWith("/party?"))) {
                String k = "";
                int qi = path.indexOf("k=");
                if (qi >= 0) { k = path.substring(qi + 2); int amp = k.indexOf('&'); if (amp >= 0) k = k.substring(0, amp); }
                boolean ok = !partyToken.isEmpty() && partyToken.equals(k) && partyPage != null;
                String html = ok ? partyPage : (partyEndedPage != null ? partyEndedPage : "<!doctype html><meta charset=utf-8><title>PartyBox</title><p>" + Tr.s("PartyBox isn't active.", "PartyBox non è attivo."));
                write(out, ok ? 200 : 410, "text/html; charset=utf-8", html.getBytes(StandardCharsets.UTF_8));
                pbPage.incrementAndGet();
                return;
            }
            if (!party && serveNative(out, method, path, devId, devName, range)) return;
            if (party) pbApi.incrementAndGet();
            int id = seq.incrementAndGet();
            CompletableFuture<JSONObject> f = new CompletableFuture<>();
            pending.put(id, f);
            JSONObject req = new JSONObject();
            req.put("id", id); req.put("method", method); req.put("path", path);
            req.put("body", new String(body, 0, r, StandardCharsets.UTF_8));
            JSONObject dev = new JSONObject(); dev.put("id", devId); dev.put("name", devName);
            req.put("device", dev);
            req.put("ip", sock.getInetAddress().getHostAddress());
            req.put("kind", party ? "party" : "connect");
            listener.onRequest(req);
            JSONObject res;
            int wait = path.startsWith("/rj/lib/index") ? 40 : path.startsWith("/rj/lib/lyrics") ? 5 : 7;
            try { res = f.get(wait, TimeUnit.SECONDS); } catch (Exception e) {
                res = new JSONObject(); res.put("status", 503); res.put("body", new JSONObject().put("error", "occupato"));
            } finally { pending.remove(id); }
            int status = res.optInt("status", 200);
            if (res.has("stream")) {
                // a track for the “speaker” PC: sent in chunks, so seeking back and forth works
                streamUri(out, res.optString("stream"), res.optString("type", "application/octet-stream"), range, "HEAD".equals(method));
                return;
            }
            if (res.has("file") && res.optBoolean("cache", false)) {
                File file = new File(res.optString("file"));
                if (!file.exists()) { write(out, 404, "application/json", "{}".getBytes(StandardCharsets.UTF_8)); return; }
                byte[] data = java.nio.file.Files.readAllBytes(file.toPath());
                String head = "HTTP/1.1 200 OK\r\nContent-Type: " + res.optString("type", "image/jpeg") + "\r\nContent-Length: " + data.length
                    + "\r\nCache-Control: max-age=604800\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n";
                out.write(head.getBytes(StandardCharsets.UTF_8)); out.write(data); out.flush();
                return;
            }
            if (res.has("file")) {
                File file = new File(res.optString("file"));
                if (!file.exists()) { write(out, 404, "application/json", "{}".getBytes(StandardCharsets.UTF_8)); return; }
                byte[] data = new byte[(int) file.length()];
                try (FileInputStream fi = new FileInputStream(file)) { int o = 0; while (o < data.length) { int n = fi.read(data, o, data.length - o); if (n < 0) break; o += n; } }
                write(out, 200, res.optString("type", "image/jpeg"), data);
            } else if (res.has("text")) {
                write(out, status, res.optString("type", "text/html; charset=utf-8"), res.optString("text").getBytes(StandardCharsets.UTF_8));
            } else {
                Object b = res.opt("body");
                write(out, status, "application/json; charset=utf-8", String.valueOf(b == null ? "{}" : b).getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            if (party) { pbErr.incrementAndGet(); pbLastErr = e.getClass().getSimpleName() + (e.getMessage() != null ? ": " + e.getMessage() : ""); }
        } finally {
            closeGently(sock);
        }
    }

    private void streamUri(OutputStream out, String uri, String type, String range, boolean headOnly) throws Exception {
        android.content.res.AssetFileDescriptor afd;
        try {
            if (uri.startsWith("content://")) afd = ctx.getContentResolver().openAssetFileDescriptor(android.net.Uri.parse(uri), "r");
            else afd = new android.content.res.AssetFileDescriptor(android.os.ParcelFileDescriptor.open(new File(uri), android.os.ParcelFileDescriptor.MODE_READ_ONLY), 0, android.content.res.AssetFileDescriptor.UNKNOWN_LENGTH);
        } catch (Exception e) { write(out, 404, "application/json", "{}".getBytes(StandardCharsets.UTF_8)); return; }
        if (afd == null) { write(out, 404, "application/json", "{}".getBytes(StandardCharsets.UTF_8)); return; }
        try (FileInputStream fis = afd.createInputStream()) {
            java.nio.channels.FileChannel ch = fis.getChannel();
            long size = afd.getLength() >= 0 ? afd.getLength() : ch.size() - afd.getStartOffset();
            sendRange(out, ch, afd.getStartOffset(), size, type, range, headOnly);
        } finally { try { afd.close(); } catch (Exception ignored) { } }
    }


    /** Sends “bytes=a-b” of a file: 206 response with Content-Range, or 200 with the whole file. */
    static void sendRange(OutputStream out, java.nio.channels.FileChannel ch, long base, long size, String type, String range, boolean headOnly) throws Exception {
        long start = 0, end = size - 1;
        boolean partial = false;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("^bytes=(\\d*)-(\\d*)$").matcher(range == null ? "" : range.trim());
        if (m.find() && (!m.group(1).isEmpty() || !m.group(2).isEmpty())) {
            partial = true;
            if (!m.group(1).isEmpty()) { start = Long.parseLong(m.group(1)); if (!m.group(2).isEmpty()) end = Math.min(Long.parseLong(m.group(2)), size - 1); }
            else start = Math.max(0, size - Long.parseLong(m.group(2)));
            if (start > end || start >= size) {
                out.write(("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" + size + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                out.flush();
                return;
            }
        }
        long len = end - start + 1;
        StringBuilder h = new StringBuilder();
        h.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
        h.append("Content-Type: ").append(type).append("\r\nAccept-Ranges: bytes\r\nContent-Length: ").append(len).append("\r\n");
        if (partial) h.append("Content-Range: bytes ").append(start).append('-').append(end).append('/').append(size).append("\r\n");
        h.append("Cache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n");
        out.write(h.toString().getBytes(StandardCharsets.UTF_8));
        if (!headOnly) {
            java.nio.ByteBuffer buf = java.nio.ByteBuffer.allocate(64 * 1024);
            long pos = base + start, left = len;
            while (left > 0) {
                buf.clear();
                if (left < buf.capacity()) buf.limit((int) left);
                int n = ch.read(buf, pos);
                if (n <= 0) break;
                out.write(buf.array(), 0, n);
                pos += n; left -= n;
            }
        }
        out.flush();
    }

    /** Closes without a “reset”: first finishes sending, then discards what the browser still has to send. */
    private static void closeGently(Socket sock) {
        try {
            if (!sock.isClosed() && !sock.isOutputShutdown()) sock.shutdownOutput();
            sock.setSoTimeout(1500);
            InputStream in = sock.getInputStream();
            byte[] buf = new byte[4096];
            long t0 = System.currentTimeMillis();
            while (System.currentTimeMillis() - t0 < 1500 && in.read(buf) >= 0) { }
        } catch (Exception ignored) { }
        try { sock.close(); } catch (Exception ignored) { }
    }

    void respond(int id, JSONObject res) {
        CompletableFuture<JSONObject> f = pending.get(id);
        if (f != null) f.complete(res);
    }

    private static String readLine(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) >= 0) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 16384) break;
        }
        if (c < 0 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }

    private static void write(OutputStream out, int status, String type, byte[] data) throws Exception {
        String reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : status == 410 ? "Gone" : status == 503 ? "Service Unavailable" : "OK";
        String head = "HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: " + type + "\r\nContent-Length: " + data.length
            + "\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(data);
        out.flush();
    }

    // ---------- client ----------
    JSONObject fetch(String host, int port, String path, String method, String body, boolean binary) throws Exception { return fetch(host, port, path, method, body, binary, 8000); }
    JSONObject fetch(String host, int port, String path, String method, String body, boolean binary, int timeout) throws Exception {
        URL u = new URL("http://" + (host.contains(":") ? "[" + host + "]" : host) + ":" + port + path);
        HttpURLConnection c = (HttpURLConnection) u.openConnection();
        c.setConnectTimeout(3000);
        c.setReadTimeout(Math.max(2000, timeout));
        c.setRequestMethod(method);
        c.setRequestProperty("X-RJ-Id", myId);
        c.setRequestProperty("X-RJ-Name", URLEncoder.encode(myName, "UTF-8"));
        if (body != null && !body.isEmpty()) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
        }
        int status = c.getResponseCode();
        InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        if (in != null) { byte[] buf = new byte[16384]; int n; while ((n = in.read(buf)) > 0) bo.write(buf, 0, n); in.close(); }
        c.disconnect();
        JSONObject o = new JSONObject();
        o.put("status", status);
        if (binary) o.put("base64", Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP));
        else o.put("body", bo.toString("UTF-8"));
        return o;
    }

    // ---------- direct scan of the home network (if mDNS doesn't find the PC) ----------
    private volatile boolean scanning = false;
    void scan() {
        if (scanning) return;
        String ip = localIp();
        if (ip.isEmpty()) return;
        scanning = true;
        try {
            String base = ip.substring(0, ip.lastIndexOf('.') + 1);
            ExecutorService ex = Executors.newFixedThreadPool(48);
            java.util.List<java.util.concurrent.Future<?>> jobs = new java.util.ArrayList<>();
            for (int h = 1; h < 255; h++) {
                final String host = base + h;
                if (host.equals(ip)) continue;
                jobs.add(ex.submit(() -> {
                    for (int p = 47123; p <= 47126; p++) {
                        try (Socket so = new Socket()) {
                            so.connect(new InetSocketAddress(host, p), 450);
                        } catch (Exception e) { continue; }
                        try {
                            JSONObject r = fetch(host, p, "/rj/info", "GET", null, false);
                            if (r.optInt("status") != 200) continue;
                            JSONObject info = new JSONObject(r.optString("body", "{}"));
                            String id = info.optString("id", "");
                            if (id.isEmpty() || id.equals(myId)) continue;
                            JSONObject d = new JSONObject();
                            d.put("id", id);
                            d.put("name", info.optString("name", host));
                            d.put("platform", info.optString("platform", ""));
                            d.put("tv", info.optBoolean("tv", false));
                            d.put("icon", info.optString("icon", ""));
                            d.put("host", host);
                            d.put("port", p);
                            JSONObject old = devices.get(id);
                            if (old != null && old.has("service")) d.put("service", old.optString("service"));
                            devices.put(id, d);
                            emitDevices();
                        } catch (Exception ignored) { }
                    }
                }));
            }
            for (java.util.concurrent.Future<?> j : jobs) { try { j.get(); } catch (Exception ignored) { } }
            ex.shutdownNow();
        } finally { scanning = false; }
    }

    void async(Runnable r) { pool.execute(r); }

    /** All the phone's home addresses (Wi‑Fi and hotspot), for the PartyBox QR code. */
    static JSONArray allIps() {
        JSONArray arr = new JSONArray();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String n = ni.getName();
                if (n.startsWith("rmnet") || n.startsWith("ccmni") || n.startsWith("dummy") || n.startsWith("tun")) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || !a.isSiteLocalAddress()) continue;
                    JSONObject o = new JSONObject();
                    o.put("ip", a.getHostAddress());
                    o.put("name", n.startsWith("wlan0") ? "Wi‑Fi" : (n.startsWith("ap") || n.startsWith("swlan") || n.startsWith("wlan1") || n.startsWith("softap")) ? Tr.s("Phone hotspot", "Hotspot del telefono") : n.startsWith("eth") ? "Cavo" : n);
                    arr.put(o);
                }
            }
        } catch (Exception ignored) { }
        return arr;
    }

    static String localIp() {
        try {
            java.util.List<NetworkInterface> list = Collections.list(NetworkInterface.getNetworkInterfaces());
            list.sort((x, y) -> Boolean.compare(!x.getName().startsWith("wlan"), !y.getName().startsWith("wlan")));
            for (NetworkInterface ni : list) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress a = addrs.nextElement();
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) return a.getHostAddress();
                }
            }
        } catch (Exception ignored) { }
        return "";
    }
}

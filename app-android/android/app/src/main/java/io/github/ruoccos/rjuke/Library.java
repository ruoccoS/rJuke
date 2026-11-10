package io.github.ruoccos.rjuke;

import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.MediaStore;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;

/** Reads the music library from the MediaStore, covers and colors. */
public class Library {

    public interface Progress { void onProgress(String phase, int done, int total); }

    private final Context ctx;

    public Library(Context ctx) { this.ctx = ctx; }

    private File coversDir() {
        File d = new File(ctx.getFilesDir(), "covers");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static String nz(String s) {
        if (s == null) return "";
        s = s.trim();
        return "<unknown>".equalsIgnoreCase(s) ? "" : s;
    }

    private Cursor query(String[] proj, String sel, String[] args) {
        return ctx.getContentResolver().query(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, proj, sel, args, null);
    }

    /** Folders that contain music, with the number of tracks. */
    public JSONArray folders() throws JSONException {
        Map<String, Integer> counts = new HashMap<>();
        try (Cursor c = query(new String[]{MediaStore.Audio.Media.DATA}, MediaStore.Audio.Media.IS_MUSIC + " != 0", null)) {
            if (c != null) while (c.moveToNext()) {
                String p = c.getString(0);
                if (p == null) continue;
                int i = p.lastIndexOf('/');
                if (i <= 0) continue;
                String dir = p.substring(0, i);
                Integer n = counts.get(dir);
                counts.put(dir, n == null ? 1 : n + 1);
            }
        }
        JSONArray out = new JSONArray();
        for (Map.Entry<String, Integer> e : counts.entrySet()) {
            JSONObject o = new JSONObject();
            o.put("dir", e.getKey());
            o.put("count", e.getValue());
            out.put(o);
        }
        return out;
    }

    public JSONObject scan(String root, Progress progress) throws Exception {
        List<JSONObject> tracks = new ArrayList<>();
        String sel = MediaStore.Audio.Media.IS_MUSIC + " != 0";
        String[] args = null;
        if (root != null && !root.isEmpty()) {
            sel += " AND " + MediaStore.Audio.Media.DATA + " LIKE ?";
            args = new String[]{root.endsWith("/") ? root + "%" : root + "/%"};
        }
        String[] base = {
            MediaStore.Audio.Media._ID, MediaStore.Audio.Media.DATA, MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST, MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.TRACK, MediaStore.Audio.Media.YEAR, MediaStore.Audio.Media.DATE_ADDED,
            MediaStore.Audio.Media.DATE_MODIFIED, MediaStore.Audio.Media.SIZE, MediaStore.Audio.Media.MIME_TYPE,
        };
        String[] withAA = new String[base.length + 1];
        System.arraycopy(base, 0, withAA, 0, base.length);
        withAA[base.length] = "album_artist";

        Cursor c;
        boolean hasAA = true;
        try { c = query(withAA, sel, args); } catch (Exception ex) { c = null; }
        if (c == null) { hasAA = false; c = query(base, sel, args); }
        if (c == null) throw new Exception(Tr.s("MediaStore not available", "MediaStore non disponibile"));

        Map<String, String> coverJobs = new LinkedHashMap<>();
        try {
            int total = c.getCount(), done = 0;
            while (c.moveToNext()) {
                long id = c.getLong(0);
                String path = c.getString(1);
                if (path == null) continue;
                String fileName = path.substring(path.lastIndexOf('/') + 1);
                String dir = path.substring(0, Math.max(0, path.lastIndexOf('/')));
                String title = nz(c.getString(2));
                if (title.isEmpty()) title = fileName.replaceAll("\\.[^.]+$", "");
                String artist = nz(c.getString(3));
                if (artist.isEmpty()) artist = Tr.s("Unknown artist", "Artista sconosciuto");
                String album = nz(c.getString(4));
                String aa = hasAA ? nz(c.getString(base.length)) : "";
                int trackRaw = c.getInt(6);
                int disc = trackRaw >= 1000 ? trackRaw / 1000 : 0;
                int trk = trackRaw % 1000;
                String albumKey = !aa.isEmpty()
                    ? "aa:" + aa.toLowerCase(Locale.ROOT) + "|" + album.toLowerCase(Locale.ROOT)
                    : "dir:" + dir.toLowerCase(Locale.ROOT) + "|" + album.toLowerCase(Locale.ROOT);
                Uri uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);

                JSONObject t = new JSONObject();
                t.put("id", id);
                t.put("path", path);
                t.put("uri", uri.toString());
                t.put("title", title);
                t.put("artist", artist);
                t.put("albumArtist", aa);
                t.put("album", album);
                t.put("albumKey", albumKey);
                int year = c.getInt(7);
                if (year > 0) t.put("year", year);
                if (trk > 0) t.put("track", trk);
                if (disc > 0) t.put("disc", disc);
                t.put("duration", c.getLong(5) / 1000.0);
                t.put("added", c.getLong(8) * 1000L);
                t.put("mtime", c.getLong(9) * 1000L);
                t.put("size", c.getLong(10));
                String mime = c.getString(11);
                t.put("codec", mime == null ? "" : mime);
                t.put("lyrics", 0);
                tracks.add(t);
                if (!coverJobs.containsKey(albumKey)) coverJobs.put(albumKey, uri.toString());
                done++;
                if (progress != null && done % 50 == 0) progress.onProgress("read", done, total);
            }
            if (progress != null) progress.onProgress("read", total, total);
        } finally {
            c.close();
        }

        // covers: one per album, in parallel
        JSONObject coverCache = loadCoverCache();
        JSONObject covers = new JSONObject();
        List<Map.Entry<String, String>> jobs = new ArrayList<>(coverJobs.entrySet());
        AtomicInteger cdone = new AtomicInteger();
        ExecutorService pool = Executors.newFixedThreadPool(3);
        List<Future<?>> fs = new ArrayList<>();
        final Object lock = new Object();
        for (Map.Entry<String, String> job : jobs) {
            fs.add(pool.submit(() -> {
                String key = job.getKey();
                try {
                    JSONObject cached = coverCache.optJSONObject(key);
                    JSONObject res;
                    if (cached != null && new File(cached.optString("s")).exists()) res = cached;
                    else if (cached != null && cached.optBoolean("none")) res = cached;
                    else res = extractCover(key, Uri.parse(job.getValue()));
                    synchronized (lock) { covers.put(key, res); }
                } catch (Exception ignored) { }
                int n = cdone.incrementAndGet();
                if (progress != null && (n % 5 == 0 || n == jobs.size())) progress.onProgress("covers", n, jobs.size());
            }));
        }
        for (Future<?> f : fs) { try { f.get(); } catch (Exception ignored) { } }
        pool.shutdown();
        saveText("covers.json", covers.toString());

        JSONArray arr = new JSONArray();
        for (JSONObject t : tracks) arr.put(t);
        JSONObject lib = new JSONObject();
        lib.put("version", 1);
        lib.put("root", root == null ? "" : root);
        lib.put("scannedAt", System.currentTimeMillis());
        lib.put("tracks", arr);
        lib.put("covers", covers);
        saveText("library.json", lib.toString());
        return lib;
    }

    JSONObject loadCoverCache() {
        try { return new JSONObject(loadText("covers.json")); } catch (Exception e) { return new JSONObject(); }
    }

    private JSONObject extractCover(String key, Uri uri) throws Exception {
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        byte[] pic = null;
        String genre = null;
        try {
            mmr.setDataSource(ctx, uri);
            pic = mmr.getEmbeddedPicture();
            genre = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_GENRE);
        } catch (Exception ignored) {
        } finally {
            try { mmr.release(); } catch (Exception ignored) { }
        }
        return coverFromBytes(key, pic, genre);
    }

    /** Cover (small and large) and colors from the image bytes. */
    JSONObject coverFromBytes(String key, byte[] pic, String genre) throws Exception {
        JSONObject o = new JSONObject();
        if (genre != null && !genre.trim().isEmpty()) o.put("genre", cleanGenre(genre));
        if (pic == null) { o.put("none", true); return o; }

        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(pic, 0, pic.length, bounds);
        int sample = 1;
        while (bounds.outWidth / (sample * 2) >= 1000) sample *= 2;
        BitmapFactory.Options opt = new BitmapFactory.Options();
        opt.inSampleSize = sample;
        Bitmap bmp = BitmapFactory.decodeByteArray(pic, 0, pic.length, opt);
        if (bmp == null) { o.put("none", true); return o; }

        String id = md5(key);
        File s = new File(coversDir(), id + "_s.jpg");
        File l = new File(coversDir(), id + "_l.jpg");
        writeJpeg(scaleTo(bmp, 360), s, 86);
        writeJpeg(scaleTo(bmp, 1000), l, 88);
        o.put("s", s.getAbsolutePath());
        o.put("l", l.getAbsolutePath());
        palette(bmp, o);
        bmp.recycle();
        return o;
    }

    private static String cleanGenre(String g) {
        g = g.trim();
        // ID3v1: "(17)" o "17"
        if (g.matches("^\\(?\\d+\\)?$")) return "";
        return g;
    }

    private static Bitmap scaleTo(Bitmap b, int w) {
        if (b.getWidth() <= w) return b;
        int h = Math.round(b.getHeight() * (w / (float) b.getWidth()));
        return Bitmap.createScaledBitmap(b, w, h, true);
    }

    private static void writeJpeg(Bitmap b, File f, int q) throws Exception {
        try (FileOutputStream out = new FileOutputStream(f)) {
            b.compress(Bitmap.CompressFormat.JPEG, q, out);
        }
    }

    private static String hex(double r, double g, double b) {
        return String.format(Locale.ROOT, "#%02x%02x%02x", (int) Math.round(r), (int) Math.round(g), (int) Math.round(b));
    }

    /** Same algorithm as the Windows version: dominant colors and brightness. */
    private static void palette(Bitmap src, JSONObject o) throws JSONException {
        Bitmap sm = Bitmap.createScaledBitmap(src, 32, 32, true);
        int[] px = new int[32 * 32];
        sm.getPixels(px, 0, 32, 0, 0, 32, 32);
        Map<Integer, double[]> buckets = new HashMap<>();
        double tr = 0, tg = 0, tb = 0;
        for (int p : px) {
            int r = (p >> 16) & 255, g = (p >> 8) & 255, b = p & 255;
            tr += r; tg += g; tb += b;
            int key = (r >> 5) << 6 | (g >> 5) << 3 | (b >> 5);
            int max = Math.max(r, Math.max(g, b)), min = Math.min(r, Math.min(g, b));
            double sat = max == 0 ? 0 : (max - min) / (double) max;
            double[] e = buckets.get(key);
            if (e == null) { e = new double[5]; buckets.put(key, e); }
            e[0] += r; e[1] += g; e[2] += b; e[3]++; e[4] += sat;
        }
        int n = px.length;
        double[] avg = {tr / n, tg / n, tb / n};
        List<double[]> list = new ArrayList<>();
        for (double[] e : buckets.values()) list.add(new double[]{e[0] / e[3], e[1] / e[3], e[2] / e[3], e[3], e[4] / e[3]});
        list.sort((a, b) -> Double.compare(b[3] * (0.6 + b[4]), a[3] * (0.6 + a[4])));
        List<double[]> picked = new ArrayList<>();
        for (double[] c : list) {
            boolean far = true;
            for (double[] p : picked) if (Math.abs(p[0] - c[0]) + Math.abs(p[1] - c[1]) + Math.abs(p[2] - c[2]) <= 70) { far = false; break; }
            if (far) picked.add(c);
            if (picked.size() == 4) break;
        }
        while (picked.size() < 4) picked.add(picked.isEmpty() ? new double[]{avg[0], avg[1], avg[2]} : picked.get(picked.size() - 1));
        JSONArray cols = new JSONArray();
        for (double[] c : picked) cols.put(hex(c[0], c[1], c[2]));
        double lum = (0.2126 * avg[0] + 0.7152 * avg[1] + 0.0722 * avg[2]) / 255.0;
        o.put("colors", cols);
        o.put("avg", hex(avg[0], avg[1], avg[2]));
        o.put("light", lum > 0.6);
        if (sm != src) sm.recycle();
    }

    private static String md5(String s) throws Exception {
        MessageDigest md = MessageDigest.getInstance("MD5");
        byte[] d = md.digest(s.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : d) sb.append(String.format(Locale.ROOT, "%02x", b));
        return sb.toString();
    }

    // ---------- app text files (settings, library, playlists) ----------
    public void saveText(String name, String text) throws Exception {
        File f = new File(ctx.getFilesDir(), name);
        File tmp = new File(ctx.getFilesDir(), name + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(text.getBytes(StandardCharsets.UTF_8)); }
        if (!tmp.renameTo(f)) {
            try (FileOutputStream out = new FileOutputStream(f)) { out.write(text.getBytes(StandardCharsets.UTF_8)); }
            tmp.delete();
        }
    }

    public String loadText(String name) throws Exception {
        File f = new File(ctx.getFilesDir(), name);
        if (!f.exists()) return null;
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return new String(bo.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}

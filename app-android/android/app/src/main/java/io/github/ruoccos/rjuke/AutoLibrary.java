package io.github.ruoccos.rjuke;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Collator;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;

/** Android Auto library: reads the same data as the app and builds the tree to browse in the car. */
public class AutoLibrary {

    // style keys recognized by Android Auto
    static final String HINT_BROWSABLE = "android.media.browse.CONTENT_STYLE_BROWSABLE_HINT";
    static final String HINT_PLAYABLE = "android.media.browse.CONTENT_STYLE_PLAYABLE_HINT";
    static final String HINT_SINGLE = "android.media.browse.CONTENT_STYLE_SINGLE_ITEM_HINT";
    static final String HINT_GROUP = "android.media.browse.CONTENT_STYLE_GROUP_TITLE_HINT";
    static final String CONTENT_STYLE_SUPPORTED = "android.media.browse.CONTENT_STYLE_SUPPORTED";
    static final String SEARCH_SUPPORTED = "android.media.browse.SEARCH_SUPPORTED";
    static final int LIST = 1, GRID = 2, CAT_LIST = 3, CAT_GRID = 4;
    static final int MAX_ITEMS = 400;

    static class T { String path, uri, title, artist, album, albumKey, coverFile; int year, track, disc; long added, durMs; }
    static class A { boolean various; String key, title, artist, aa = "", coverFile, genre = ""; int year; long added; List<T> tracks = new ArrayList<>(); }
    static class Ar { String key, name, coverFile; List<A> albums = new ArrayList<>(); List<T> tracks = new ArrayList<>(); }
    static class Pl { String id, name; List<T> tracks = new ArrayList<>(); }

    private final Context ctx;
    private long stamp = -1;
    List<T> tracks = new ArrayList<>();
    Map<String, T> byPath = new HashMap<>();
    List<A> albums = new ArrayList<>();
    Map<String, A> albumMap = new HashMap<>();
    List<Ar> artists = new ArrayList<>();
    Map<String, Ar> artistMap = new HashMap<>();
    List<Pl> playlists = new ArrayList<>();
    Map<String, Pl> plMap = new HashMap<>();
    String userName = "";
    JSONArray recent = new JSONArray();
    private final Collator coll;

    AutoLibrary(Context ctx) {
        this.ctx = ctx;
        Tr.init(ctx);
        coll = Collator.getInstance(Locale.ITALIAN);
        coll.setStrength(Collator.PRIMARY);
    }

    private File file(String n) { return new File(ctx.getFilesDir(), n); }

    private String read(String n) {
        try {
            File f = file(n);
            if (!f.exists()) return null;
            return new String(java.nio.file.Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
        } catch (Exception e) { return null; }
    }

    static String norm(String s) {
        if (s == null) return "";
        return Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT);
    }
    private static String sortName(String s) { return s == null ? "" : s.replaceFirst("(?i)^(the|il|lo|la|i|gli|le)\\s+", ""); }

    /** Reloads the data only if the files have changed. */
    synchronized void refresh() {
        long st = file("library.json").lastModified() + file("playlists.json").lastModified() * 3 + file("settings.json").lastModified() * 7 + file("recent.json").lastModified() * 11;
        if (st == stamp) return;
        stamp = st;
        tracks = new ArrayList<>(); byPath = new HashMap<>(); albums = new ArrayList<>(); albumMap = new LinkedHashMap<>();
        artists = new ArrayList<>(); artistMap = new HashMap<>(); playlists = new ArrayList<>(); plMap = new HashMap<>();
        try {
            JSONObject lib = new JSONObject(read("library.json"));
            JSONObject covers = lib.optJSONObject("covers");
            JSONArray arr = lib.optJSONArray("tracks");
            for (int i = 0; arr != null && i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                T t = new T();
                t.path = o.optString("path"); t.uri = o.optString("uri"); t.title = o.optString("title");
                t.artist = o.optString("artist"); t.album = o.optString("album"); t.albumKey = o.optString("albumKey");
                t.year = o.optInt("year"); t.track = o.optInt("track"); t.disc = o.optInt("disc"); t.added = o.optLong("added");
                t.durMs = Math.round(o.optDouble("duration", 0) * 1000);
                JSONObject c = covers != null ? covers.optJSONObject(t.albumKey) : null;
                if (c != null && c.has("l")) t.coverFile = new File(c.optString("l")).getName();
                tracks.add(t); byPath.put(t.path, t);
                A a = albumMap.get(t.albumKey);
                if (a == null) {
                    a = new A(); a.key = t.albumKey; a.title = t.album.isEmpty() ? Tr.s("Unknown album", "Album sconosciuto") : t.album; a.coverFile = t.coverFile;
                    if (c != null) a.genre = c.optString("genre", "");
                    albumMap.put(a.key, a);
                }
                a.tracks.add(t);
                String aa = o.optString("albumArtist", "");
                if (!aa.isEmpty() && a.aa.isEmpty()) a.aa = aa;
                if (t.year > a.year) a.year = t.year;
                a.added = Math.max(a.added, t.added);
            }
        } catch (Exception ignored) { }
        albums = new ArrayList<>(albumMap.values());
        for (A a : albums) {
            Collections.sort(a.tracks, (x, y) -> {
                int d = Math.max(1, x.disc) - Math.max(1, y.disc);
                if (d != 0) return d;
                int k = (x.track == 0 ? 999 : x.track) - (y.track == 0 ? 999 : y.track);
                return k != 0 ? k : coll.compare(x.title, y.title);
            });
            java.util.Set<String> names = new java.util.HashSet<>();
            for (T t : a.tracks) names.add(t.artist);
            a.various = a.aa.isEmpty() && names.size() != 1;
            a.artist = !a.various ? (!a.aa.isEmpty() ? a.aa : a.tracks.get(0).artist) : Tr.s("Various artists", "Artisti vari");
        }
        Collections.sort(albums, (x, y) -> coll.compare(sortName(x.title), sortName(y.title)));
        for (A a : albums) if (!a.various) for (String n : splitArtists(a.artist)) artistFor(n).albums.add(a);
        for (T t : tracks) for (String n : splitArtists(t.artist)) artistFor(n).tracks.add(t);
        artists = new ArrayList<>(artistMap.values());
        for (Ar ar : artists) {
            Collections.sort(ar.albums, (x, y) -> y.year - x.year);
            for (A a : ar.albums) if (a.coverFile != null) { ar.coverFile = a.coverFile; break; }
            if (ar.coverFile == null) for (T t : ar.tracks) if (t.coverFile != null) { ar.coverFile = t.coverFile; break; }
        }
        Collections.sort(artists, (x, y) -> coll.compare(sortName(x.name), sortName(y.name)));
        try {
            JSONArray pls = new JSONArray(read("playlists.json"));
            for (int i = 0; i < pls.length(); i++) {
                JSONObject o = pls.getJSONObject(i);
                Pl p = new Pl(); p.id = o.optString("id"); p.name = o.optString("name");
                JSONArray ps = o.optJSONArray("paths");
                for (int k = 0; ps != null && k < ps.length(); k++) { T t = byPath.get(ps.getString(k)); if (t != null) p.tracks.add(t); }
                playlists.add(p); plMap.put(p.id, p);
            }
        } catch (Exception ignored) { }
        try { userName = new JSONObject(read("settings.json")).optString("name", ""); } catch (Exception e) { userName = ""; }
        try { recent = new JSONArray(read("recent.json")); } catch (Exception e) { recent = new JSONArray(); }
    }

    // “21 Savage, Travis Scott” are two artists (as in the app): comma, “;”, “ / ”, feat.
    private static final String[] ARTIST_KEEP = { "tyler, the creator", "earth, wind & fire", "crosby, stills, nash & young", "crosby, stills & nash", "emerson, lake & palmer", "blood, sweat & tears", "peter, paul and mary", "now, now" };
    static List<String> splitArtists(String s) {
        List<String> out = new ArrayList<>();
        s = s == null ? "" : s.trim();
        if (s.isEmpty()) { out.add(Tr.s("Unknown artist", "Artista sconosciuto")); return out; }
        List<String> keep = new ArrayList<>();
        String rest = s;
        for (String k : ARTIST_KEEP) {
            int i = rest.toLowerCase(Locale.ROOT).indexOf(k);
            if (i >= 0) { keep.add(rest.substring(i, i + k.length())); rest = rest.substring(0, i) + "\u0001" + rest.substring(i + k.length()); }
        }
        int ki = 0;
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (String part : rest.split("(?i)\\s*(?:,|;|\\s/\\s|\\s+(?:feat\\.?|ft\\.?|featuring)\\s+)\\s*")) {
            StringBuilder b = new StringBuilder();
            for (char ch : part.toCharArray()) { if (ch == '\u0001') b.append(ki < keep.size() ? keep.get(ki++) : ""); else b.append(ch); }
            String n = b.toString().trim();
            if (!n.isEmpty() && seen.add(norm(n))) out.add(n);
        }
        if (out.isEmpty()) out.add(s);
        return out;
    }

    private Ar artistFor(String name) {
        String k = norm(name);
        Ar ar = artistMap.get(k);
        if (ar == null) { ar = new Ar(); ar.key = k; ar.name = name; artistMap.put(k, ar); }
        return ar;
    }

    // ---------- covers ----------
    Uri art(String coverFile, String keyForPlaceholder, String glyph) {
        if (coverFile != null && new File(new File(ctx.getFilesDir(), "covers"), coverFile).exists()) return ArtworkProvider.uriFor(ctx, coverFile);
        return placeholder(keyForPlaceholder, glyph);
    }

    /** Designed cover for albums without an image: a gradient in the app's colors and a note. */
    private Uri placeholder(String key, String glyph) {
        try {
            String name = "ph_" + md5(key + glyph) + ".png";
            File dir = new File(ctx.getFilesDir(), "covers");
            if (!dir.exists()) dir.mkdirs();
            File f = new File(dir, name);
            if (!f.exists()) {
                int S = 512;
                Bitmap b = Bitmap.createBitmap(S, S, Bitmap.Config.ARGB_8888);
                Canvas c = new Canvas(b);
                float hue = (Math.abs(key.hashCode()) % 360);
                int c1 = Color.HSVToColor(new float[]{hue, 0.45f, 0.78f});
                int c2 = Color.HSVToColor(new float[]{(hue + 38) % 360, 0.55f, 0.42f});
                Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
                p.setShader(new LinearGradient(0, 0, S, S, c1, c2, Shader.TileMode.CLAMP));
                c.drawRect(0, 0, S, S, p);
                Paint t = new Paint(Paint.ANTI_ALIAS_FLAG);
                t.setColor(Color.argb(225, 255, 255, 255));
                t.setTextAlign(Paint.Align.CENTER);
                t.setTextSize(S * 0.42f);
                t.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
                Paint.FontMetrics fm = t.getFontMetrics();
                c.drawText(glyph, S / 2f, S / 2f - (fm.ascent + fm.descent) / 2f, t);
                try (FileOutputStream out = new FileOutputStream(f)) { b.compress(Bitmap.CompressFormat.PNG, 100, out); }
                b.recycle();
            }
            return ArtworkProvider.uriFor(ctx, name);
        } catch (Exception e) {
            return null;
        }
    }

    Uri res(String drawable) {
        return Uri.parse("android.resource://" + ctx.getPackageName() + "/drawable/" + drawable);
    }

    private static String md5(String s) throws Exception {
        MessageDigest md = MessageDigest.getInstance("MD5");
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest(s.getBytes(StandardCharsets.UTF_8))) sb.append(String.format(Locale.ROOT, "%02x", b));
        return sb.toString();
    }

    // ---------- building the items ----------
    static Bundle hints(int browsable, int playable) {
        Bundle b = new Bundle();
        if (browsable > 0) b.putInt(HINT_BROWSABLE, browsable);
        if (playable > 0) b.putInt(HINT_PLAYABLE, playable);
        return b;
    }

    MediaItem folder(String id, String title, String subtitle, Uri artwork, int mediaType, Bundle extras) {
        MediaMetadata.Builder md = new MediaMetadata.Builder()
            .setTitle(title).setSubtitle(subtitle).setIsBrowsable(true).setIsPlayable(false)
            .setMediaType(mediaType).setArtworkUri(artwork);
        if (extras != null) md.setExtras(extras);
        return new MediaItem.Builder().setMediaId(id).setMediaMetadata(md.build()).build();
    }

    MediaItem playable(String id, String title, String subtitle, Uri artwork, Bundle extras) {
        MediaMetadata.Builder md = new MediaMetadata.Builder()
            .setTitle(title).setArtist(subtitle).setSubtitle(subtitle).setIsBrowsable(false).setIsPlayable(true)
            .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC).setArtworkUri(artwork);
        if (extras != null) md.setExtras(extras);
        return new MediaItem.Builder().setMediaId(id).setMediaMetadata(md.build()).build();
    }

    private static Bundle group(String title, Bundle base) {
        Bundle b = base != null ? new Bundle(base) : new Bundle();
        b.putString(HINT_GROUP, title);
        return b;
    }

    String albumSub(A a) {
        return a.year > 0 ? a.artist + " · " + a.year : a.artist;
    }

    MediaItem albumItem(A a, Bundle extra) {
        Bundle b = hints(0, LIST);
        if (extra != null) b.putAll(extra);
        return folder("album:" + a.key, a.title, albumSub(a), art(a.coverFile, a.key, "♪"), MediaMetadata.MEDIA_TYPE_ALBUM, b);
    }

    MediaItem playlistItem(Pl p, Bundle extra) {
        Bundle b = hints(0, LIST);
        if (extra != null) b.putAll(extra);
        String cov = null;
        for (T t : p.tracks) if (t.coverFile != null) { cov = t.coverFile; break; }
        return folder("pl:" + p.id, p.name, tracksLabel(p.tracks.size()), art(cov, "pl" + p.id, "♫"), MediaMetadata.MEDIA_TYPE_PLAYLIST, b);
    }

    MediaItem artistItem(Ar ar) {
        String sub = (ar.albums.isEmpty() ? "" : plural(ar.albums.size(), "album", Tr.s("albums", "album")) + " · ") + tracksLabel(ar.tracks.size());
        return folder("artist:" + ar.key, ar.name, sub, art(ar.coverFile, "ar" + ar.key, ar.name.isEmpty() ? "♪" : ar.name.substring(0, 1).toUpperCase(Locale.ROOT)),
            MediaMetadata.MEDIA_TYPE_ARTIST, hints(GRID, LIST));
    }

    MediaItem trackItem(String ctxId, int i, T t, String sub) {
        return playable("play|" + ctxId + "|" + i, t.title, sub != null ? sub : t.artist, art(t.coverFile, t.albumKey, "♪"), null);
    }

    static String plural(int n, String one, String many) { return n + " " + (n == 1 ? one : many); }
    static String tracksLabel(int n) { return plural(n, Tr.s("track", "brano"), Tr.s("tracks", "brani")); }

    // ---------- tree ----------
    MediaItem root() {
        Bundle b = hints(GRID, LIST);
        b.putBoolean(CONTENT_STYLE_SUPPORTED, true);
        b.putBoolean(SEARCH_SUPPORTED, true);
        return folder("root", "rJuke", "", null, MediaMetadata.MEDIA_TYPE_FOLDER_MIXED, b);
    }

    List<MediaItem> children(String id) {
        refresh();
        List<MediaItem> out = new ArrayList<>();
        if ("root".equals(id)) {
            out.add(folder("home", "Home", "", res("ic_aa_home"), MediaMetadata.MEDIA_TYPE_FOLDER_MIXED, hints(GRID, LIST)));
            out.add(folder("playlists", Tr.s("Playlists", "Playlist"), "", res("ic_aa_playlist"), MediaMetadata.MEDIA_TYPE_FOLDER_PLAYLISTS, hints(GRID, LIST)));
            out.add(folder("artists", Tr.s("Artists", "Artisti"), "", res("ic_aa_artist"), MediaMetadata.MEDIA_TYPE_FOLDER_ARTISTS, hints(GRID, LIST)));
            out.add(folder("albums", Tr.s("Albums", "Album"), "", res("ic_aa_album"), MediaMetadata.MEDIA_TYPE_FOLDER_ALBUMS, hints(GRID, LIST)));
            return out;
        }
        if ("home".equals(id)) {
            String start = Tr.s("Get started", "Per iniziare");
            Bundle g0 = group(start, null);
            g0.putInt(HINT_SINGLE, LIST);
            if (!tracks.isEmpty()) out.add(playable("play|shuffle-all|0", Tr.s("Shuffle", "Riproduzione casuale"), userName.isEmpty() ? Tr.s(tracksLabel(tracks.size()) + " · all your music", tracksLabel(tracks.size()) + " di tutta la tua musica") : Tr.s(tracksLabel(tracks.size()) + " · " + userName + "'s music", tracksLabel(tracks.size()) + " di " + userName), res("ic_aa_shuffle_art"), g0));
            // recently played
            String rec = Tr.s("Recently played", "Ascoltati di recente");
            int n = 0;
            for (int i = 0; i < recent.length() && n < 8; i++) {
                JSONObject c = recent.optJSONObject(i); if (c == null) continue;
                if ("album".equals(c.optString("type")) && albumMap.containsKey(c.optString("key"))) { out.add(albumItem(albumMap.get(c.optString("key")), group(rec, null))); n++; }
                else if ("playlist".equals(c.optString("type")) && plMap.containsKey(c.optString("id"))) { out.add(playlistItem(plMap.get(c.optString("id")), group(rec, null))); n++; }
            }
            // picked for you (they change every day, as in the app)
            String picks = userName.isEmpty() ? Tr.s("Picked for you", "Scelti per te") : Tr.s("Picked for you, ", "Scelti per te, ") + userName;
            List<A> pool = new ArrayList<>(albums);
            Calendar cal = Calendar.getInstance();
            Collections.shuffle(pool, new Random(cal.get(Calendar.YEAR) * 1000L + cal.get(Calendar.DAY_OF_YEAR)));
            for (int i = 0; i < Math.min(8, pool.size()); i++) out.add(albumItem(pool.get(i), group(picks, null)));
            // recently added
            List<A> added = new ArrayList<>(albums);
            Collections.sort(added, (x, y) -> Long.compare(y.added, x.added));
            for (int i = 0; i < Math.min(8, added.size()); i++) out.add(albumItem(added.get(i), group(Tr.s("Recently added", "Aggiunti di recente"), null)));
            return out;
        }
        if ("playlists".equals(id)) { for (Pl p : playlists) out.add(playlistItem(p, null)); return cap(out); }
        if ("artists".equals(id)) { for (Ar ar : artists) out.add(artistItem(ar)); return cap(out); }
        if ("albums".equals(id)) { for (A a : albums) out.add(albumItem(a, null)); return cap(out); }
        if (id.startsWith("album:")) {
            A a = albumMap.get(id.substring(6)); if (a == null) return out;
            boolean showArtist = a.various;
            for (T t : a.tracks) if (!norm(t.artist).equals(norm(a.artist))) { showArtist = true; break; }
            if (a.tracks.size() > 1) out.add(shuffleItem(id, a.tracks.size()));
            for (int i = 0; i < a.tracks.size(); i++) {
                T t = a.tracks.get(i);
                String sub = (t.track > 0 ? t.track + ". " : "") + (showArtist ? t.artist : a.title);
                out.add(trackItem(id, i, t, sub));
            }
            return cap(out);
        }
        if (id.startsWith("pl:")) {
            Pl p = plMap.get(id.substring(3)); if (p == null) return out;
            if (p.tracks.size() > 1) out.add(shuffleItem(id, p.tracks.size()));
            for (int i = 0; i < p.tracks.size(); i++) { T t = p.tracks.get(i); out.add(trackItem(id, i, t, t.artist + " · " + t.album)); }
            return cap(out);
        }
        if (id.startsWith("artist:")) {
            Ar ar = artistMap.get(id.substring(7)); if (ar == null) return out;
            List<T> top = artistTracks(ar);
            Bundle gb = group(Tr.s("Tracks", "Brani"), null); gb.putInt(HINT_SINGLE, LIST);
            if (top.size() > 1) { MediaItem sh = shuffleItem(id, top.size()); out.add(sh.buildUpon().setMediaMetadata(sh.mediaMetadata.buildUpon().setExtras(gb).build()).build()); }
            for (int i = 0; i < Math.min(12, top.size()); i++) {
                T t = top.get(i);
                MediaItem it = trackItem(id, i, t, t.album);
                MediaMetadata md = it.mediaMetadata.buildUpon().setExtras(gb).build();
                out.add(it.buildUpon().setMediaMetadata(md).build());
            }
            for (A a : ar.albums) out.add(albumItem(a, group(Tr.s("Albums", "Album"), null)));
            return out;
        }
        return out;
    }

    /** “Shuffle” at the top of playlists, albums and artists (as in the app). */
    private MediaItem shuffleItem(String ctxId, int n) {
        return playable("play|shuffle:" + ctxId + "|0", Tr.s("Shuffle", "Riproduzione casuale"), Tr.s("All " + n + " tracks in random order", "Tutti i " + n + " brani in ordine casuale"), res("ic_aa_shuffle_art"), null);
    }

    private List<MediaItem> cap(List<MediaItem> l) { return l.size() > MAX_ITEMS ? new ArrayList<>(l.subList(0, MAX_ITEMS)) : l; }

    List<T> artistTracks(Ar ar) {
        List<T> l = new ArrayList<>(ar.tracks);
        Collections.sort(l, (x, y) -> {
            int yy = (albumMap.get(y.albumKey) != null ? albumMap.get(y.albumKey).year : 0) - (albumMap.get(x.albumKey) != null ? albumMap.get(x.albumKey).year : 0);
            if (yy != 0) return yy;
            int c = coll.compare(x.album, y.album);
            if (c != 0) return c;
            return (Math.max(1, x.disc) * 1000 + x.track) - (Math.max(1, y.disc) * 1000 + y.track);
        });
        return l;
    }

    MediaItem item(String id) {
        refresh();
        if ("root".equals(id)) return root();
        if (id.startsWith("album:")) { A a = albumMap.get(id.substring(6)); return a == null ? null : albumItem(a, null); }
        if (id.startsWith("pl:")) { Pl p = plMap.get(id.substring(3)); return p == null ? null : playlistItem(p, null); }
        if (id.startsWith("artist:")) { Ar ar = artistMap.get(id.substring(7)); return ar == null ? null : artistItem(ar); }
        if (id.startsWith("play|")) { List<MediaItem> q = resolve(id); return q.isEmpty() ? null : q.get(0); }
        T t = byPath.get(id);
        return t == null ? null : queueItem(t);
    }

    // ---------- playback ----------
    MediaItem queueItem(T t) {
        MediaMetadata.Builder md = new MediaMetadata.Builder()
            .setTitle(t.title).setArtist(t.artist).setAlbumTitle(t.album)
            .setIsBrowsable(false).setIsPlayable(true).setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC);
        if (t.durMs > 0) md.setDurationMs(t.durMs);
        if (t.coverFile != null) md.setArtworkUri(ArtworkProvider.uriFor(ctx, t.coverFile));
        return new MediaItem.Builder().setMediaId(t.path).setUri(Uri.parse(t.uri)).setMediaMetadata(md.build()).build();
    }

    List<T> context(String ctxId) {
        if (ctxId.startsWith("shuffle:")) return context(ctxId.substring(8));
        if ("shuffle-all".equals(ctxId)) { List<T> l = new ArrayList<>(tracks); Collections.shuffle(l); return l; }
        if (ctxId.startsWith("album:")) { A a = albumMap.get(ctxId.substring(6)); return a == null ? new ArrayList<>() : a.tracks; }
        if (ctxId.startsWith("pl:")) { Pl p = plMap.get(ctxId.substring(3)); return p == null ? new ArrayList<>() : p.tracks; }
        if (ctxId.startsWith("artist:")) { Ar ar = artistMap.get(ctxId.substring(7)); return ar == null ? new ArrayList<>() : artistTracks(ar); }
        return new ArrayList<>();
    }

    /** "play|context|index" → full queue starting from the chosen track. */
    List<MediaItem> resolve(String id) {
        refresh();
        List<MediaItem> out = new ArrayList<>();
        String c = ctxOf(id);
        if (c == null) return out;
        List<T> l = context(c);
        int start = idxOf(id);
        if (start < 0 || start >= l.size()) start = 0;
        for (int i = start; i < l.size(); i++) out.add(queueItem(l.get(i)));
        for (int i = 0; i < start; i++) out.add(queueItem(l.get(i)));
        return out;
    }

    /** Full queue and starting position (keeps the album order: tracks before the chosen one stay before it). */
    int resolveStart(String id) { return idxOf(id); }

    /** "play|context|index": the context may contain “|” (album keys use it), so the index is after the last “|” (bug #16). */
    static String ctxOf(String id) {
        if (id == null || !id.startsWith("play|")) return null;
        int last = id.lastIndexOf('|');
        return last <= 4 ? null : id.substring(5, last);
    }
    static int idxOf(String id) {
        try { return Math.max(0, Integer.parseInt(id.substring(id.lastIndexOf('|') + 1))); } catch (Exception e) { return 0; }
    }

    List<MediaItem> resolveOrdered(String id) {
        refresh();
        List<MediaItem> out = new ArrayList<>();
        String c = ctxOf(id);
        if (c == null) return out;
        for (T t : context(c)) out.add(queueItem(t));
        return out;
    }

    // ---------- search (voice too) ----------
    List<MediaItem> search(String query) {
        refresh();
        List<MediaItem> out = new ArrayList<>();
        String q = norm(query).trim();
        if (q.isEmpty()) return out;
        String[] terms = q.split("\\s+");
        for (Ar ar : artists) if (match(norm(ar.name), terms)) { out.add(artistItem(ar)); if (out.size() >= 5) break; }
        int na = 0;
        for (A a : albums) if (match(norm(a.title + " " + a.artist), terms)) { out.add(albumItem(a, null)); if (++na >= 10) break; }
        int nt = 0;
        for (T t : tracks) {
            if (!match(norm(t.title + " " + t.artist + " " + t.album), terms)) continue;
            A a = albumMap.get(t.albumKey);
            int idx = a != null ? a.tracks.indexOf(t) : 0;
            out.add(trackItem("album:" + t.albumKey, Math.max(0, idx), t, t.artist + " · " + t.album));
            if (++nt >= 40) break;
        }
        return out;
    }

    private static boolean match(String s, String[] terms) { for (String w : terms) if (!s.contains(w)) return false; return true; }

    /** “Ok Google, play …”: best matching artist, album or track; with no words, all the music shuffled. */
    /** how the Assistant may hear the app's name */
    static final String APP_RE = "(?:r ?juke|erre ?juke)";
    List<MediaItem> playFromSearch(String query) { return playFromSearch(query, null); }

    List<MediaItem> playFromSearch(String query, Bundle extras) {
        refresh();
        String q = norm(query == null ? "" : query).replaceAll("[^\\p{L}\\p{N} ]", " ").replaceAll("\\s+", " ").trim();
        // the Assistant often adds “on rJuke”, “by”, “the song” etc.
        q = q.replaceAll("\\b(su|con|in|on) " + APP_RE + "\\b", "").replaceAll("^(metti|riproduci|ascolta|fai partire|suona|play)\\s+", "")
             .replaceAll("^(la canzone|il brano|la playlist|l album|album|playlist|canzone|brano|musica di|le canzoni di|qualcosa di)\\s+", "").trim();
        String eTitle = extras != null ? norm(extras.getString(android.provider.MediaStore.EXTRA_MEDIA_TITLE, "")) : "";
        String eArtist = extras != null ? norm(extras.getString(android.provider.MediaStore.EXTRA_MEDIA_ARTIST, "")) : "";
        String eAlbum = extras != null ? norm(extras.getString(android.provider.MediaStore.EXTRA_MEDIA_ALBUM, "")) : "";
        String ePl = extras != null ? norm(extras.getString("android.intent.extra.playlist", "")) : "";
        if (q.isEmpty() && eTitle.isEmpty() && eArtist.isEmpty() && eAlbum.isEmpty() && ePl.isEmpty()) return resolve("play|shuffle-all|0");
        // 1) precise hints from the Assistant
        if (!ePl.isEmpty()) for (Pl p : playlists) if (norm(p.name).contains(ePl)) return resolve("play|pl:" + p.id + "|0");
        if (!eTitle.isEmpty()) {
            T best = null;
            for (T t : tracks) {
                if (!norm(t.title).contains(eTitle) && !eTitle.contains(norm(t.title))) continue;
                if (!eArtist.isEmpty() && !norm(t.artist).contains(eArtist)) { if (best == null) best = t; continue; }
                best = t; break;
            }
            if (best != null) return playTrack(best);
        }
        if (!eAlbum.isEmpty()) for (A a : albums) if (norm(a.title).contains(eAlbum)) return resolve("play|album:" + a.key + "|0");
        if (!eArtist.isEmpty()) for (Ar ar : artists) if (norm(ar.name).contains(eArtist)) return artistQueue(ar);
        if (q.isEmpty()) return resolve("play|shuffle-all|0");
        // 2) free text: exact matches, then all the words, then the closest one
        for (Pl p : playlists) if (norm(p.name).equals(q)) return resolve("play|pl:" + p.id + "|0");
        for (Ar ar : artists) if (norm(ar.name).equals(q)) return artistQueue(ar);
        for (A a : albums) if (norm(a.title).equals(q)) return resolve("play|album:" + a.key + "|0");
        for (T t : tracks) if (norm(t.title).equals(q)) return playTrack(t);
        String[] terms = q.split(" ");
        for (T t : tracks) if (match(norm(t.title + " " + t.artist), terms)) return playTrack(t);
        for (Ar ar : artists) if (match(norm(ar.name), terms)) return artistQueue(ar);
        for (A a : albums) if (match(norm(a.title + " " + a.artist), terms)) return resolve("play|album:" + a.key + "|0");
        for (Pl p : playlists) if (match(norm(p.name), terms)) return resolve("play|pl:" + p.id + "|0");
        T best = null; int bestScore = 0;
        for (T t : tracks) {
            String hay = norm(t.title + " " + t.artist + " " + t.album);
            int sc = 0;
            for (String w : terms) if (w.length() > 1 && hay.contains(w)) sc += w.length();
            if (sc > bestScore) { bestScore = sc; best = t; }
        }
        if (best != null && bestScore >= Math.max(3, q.replace(" ", "").length() / 2)) return playTrack(best);
        return new ArrayList<>();
    }

    private List<MediaItem> playTrack(T t) {
        A a = albumMap.get(t.albumKey);
        List<MediaItem> l = new ArrayList<>();
        int i = a != null ? Math.max(0, a.tracks.indexOf(t)) : 0;
        List<T> src = a != null ? a.tracks : java.util.Collections.singletonList(t);
        for (int k = i; k < src.size(); k++) l.add(queueItem(src.get(k)));
        for (int k = 0; k < i; k++) l.add(queueItem(src.get(k)));
        return l;
    }
    private List<MediaItem> artistQueue(Ar ar) { List<MediaItem> l = new ArrayList<>(); for (T t : artistTracks(ar)) l.add(queueItem(t)); return l; }
}

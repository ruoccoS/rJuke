package io.github.ruoccos.rjuke;

import android.content.Context;

import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Locale;

/** Texts shown by the native side (Android Auto, notifications): same language as the app (settings “lang”, otherwise the system's). */
final class Tr {
    private static File settings;
    private static long seen = Long.MIN_VALUE;
    private static boolean it = isItalian(null);

    static synchronized void init(Context c) { if (settings == null) settings = new File(c.getApplicationContext().getFilesDir(), "settings.json"); }

    /** English or Italian text, depending on the app language. */
    static String s(String en, String itText) { return italian() ? itText : en; }

    private static synchronized boolean italian() {
        if (settings == null) return it;
        long m = settings.lastModified();
        if (m != seen) {
            seen = m;
            String lang = null;
            try { lang = new JSONObject(new String(Files.readAllBytes(settings.toPath()), StandardCharsets.UTF_8)).optString("lang", null); } catch (Exception ignored) { }
            it = isItalian(lang);
        }
        return it;
    }

    private static boolean isItalian(String lang) {
        if ("it".equals(lang)) return true;
        if ("en".equals(lang)) return false;
        return "it".equals(Locale.getDefault().getLanguage());
    }
}

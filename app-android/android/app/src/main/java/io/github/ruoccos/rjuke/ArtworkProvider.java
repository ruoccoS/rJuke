package io.github.ruoccos.rjuke;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Provides covers to Android Auto (which cannot read the app's private files). Serves only the images
 * in the "covers" folder, read-only.
 */
public class ArtworkProvider extends ContentProvider {

    public static Uri uriFor(android.content.Context ctx, String fileName) {
        return new Uri.Builder().scheme("content").authority(ctx.getPackageName() + ".art").appendPath(fileName).build();
    }

    /** App cover → an address readable by Android Auto and by the “Now playing” card (bug #15). */
    public static Uri uriForPath(String path) {
        File f = new File(path);
        File dir = f.getParentFile();
        if (dir != null && "covers".equals(dir.getName()) && f.getName().matches("[A-Za-z0-9_.-]+"))
            return new Uri.Builder().scheme("content").authority(BuildConfig.APPLICATION_ID + ".art").appendPath(f.getName()).build();
        return Uri.fromFile(f);
    }

    @Override
    public boolean onCreate() { return true; }

    @Nullable
    @Override
    public ParcelFileDescriptor openFile(@NonNull Uri uri, @NonNull String mode) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("/") || name.contains("..") || !name.matches("[A-Za-z0-9_.-]+")) throw new FileNotFoundException();
        File f = new File(new File(getContext().getFilesDir(), "covers"), name);
        if (!f.exists()) throw new FileNotFoundException();
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Nullable
    @Override
    public String getType(@NonNull Uri uri) {
        String n = uri.getLastPathSegment();
        return n != null && n.endsWith(".png") ? "image/png" : "image/jpeg";
    }

    @Nullable @Override public Cursor query(@NonNull Uri uri, @Nullable String[] p, @Nullable String s, @Nullable String[] a, @Nullable String o) { return null; }
    @Nullable @Override public Uri insert(@NonNull Uri uri, @Nullable ContentValues values) { return null; }
    @Override public int delete(@NonNull Uri uri, @Nullable String s, @Nullable String[] a) { return 0; }
    @Override public int update(@NonNull Uri uri, @Nullable ContentValues v, @Nullable String s, @Nullable String[] a) { return 0; }
}

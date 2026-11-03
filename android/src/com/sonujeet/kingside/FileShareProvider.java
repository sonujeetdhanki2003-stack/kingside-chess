package com.sonujeet.kingside;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/** v1.7: hands a GIF made in the page to other apps (share sheet) without any library: files live in cache/shared. */
public class FileShareProvider extends ContentProvider {
    static final String AUTH = "com.sonujeet.kingside.files";

    static String safe(String name) {
        String n = name == null ? "" : name.replaceAll("[^A-Za-z0-9._-]", "-");
        if (n.isEmpty() || n.startsWith(".")) n = "kingside-game.gif";
        return n.length() > 80 ? n.substring(n.length() - 80) : n;
    }
    static Uri write(Context ctx, String b64, String name) throws IOException {
        File dir = new File(ctx.getCacheDir(), "shared");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("no cache dir");
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) if (System.currentTimeMillis() - f.lastModified() > 86400000L) f.delete();
        File f = new File(dir, safe(name));
        try (FileOutputStream out = new FileOutputStream(f)) { out.write(Base64.decode(b64, Base64.DEFAULT)); }
        return Uri.parse("content://" + AUTH + "/shared/" + Uri.encode(f.getName()));
    }
    /** Pictures/Kingside Chess on Android 10+ (no permission needed); the app's own Pictures folder before that. */
    static String saveToPictures(Context ctx, String b64, String mime, String name) throws IOException {
        byte[] data = Base64.decode(b64, Base64.DEFAULT);
        String n = safe(name);
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, n);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime == null || mime.isEmpty() ? "image/gif" : mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Kingside Chess");
            Uri uri = ctx.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IOException("insert failed");
            try (OutputStream out = ctx.getContentResolver().openOutputStream(uri)) { if (out == null) throw new IOException("no stream"); out.write(data); }
            return "Pictures/Kingside Chess";
        }
        File dir = ctx.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (dir == null) throw new IOException("no storage");
        File f = new File(dir, n);
        try (FileOutputStream out = new FileOutputStream(f)) { out.write(data); }
        return f.getAbsolutePath();
    }
    private File fileFor(Uri uri) throws FileNotFoundException {
        String last = uri.getLastPathSegment();
        if (last == null || !"shared".equals(uri.getPathSegments().size() > 0 ? uri.getPathSegments().get(0) : "")) throw new FileNotFoundException();
        File f = new File(new File(getContext().getCacheDir(), "shared"), safe(last));
        if (!f.exists()) throw new FileNotFoundException(last);
        return f;
    }
    @Override public boolean onCreate() { return true; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public String getType(Uri uri) {
        String p = uri.getPath() == null ? "" : uri.getPath().toLowerCase();
        return p.endsWith(".gif") ? "image/gif" : p.endsWith(".png") ? "image/png" : p.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream";
    }
    @Override public Cursor query(Uri uri, String[] projection, String sel, String[] args, String sort) {
        File f;
        try { f = fileFor(uri); } catch (FileNotFoundException e) { return null; }
        String[] cols = projection != null ? projection : new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE };
        MatrixCursor c = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
        }
        c.addRow(row);
        return c;
    }
    @Override public Uri insert(Uri uri, ContentValues v) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}

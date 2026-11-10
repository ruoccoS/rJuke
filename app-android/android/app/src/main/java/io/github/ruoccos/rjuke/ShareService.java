package io.github.ruoccos.rjuke;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

/**
 * Keeps the phone awake while a “speaker” PC uses its music (bug #50): foreground service with a
 * discreet notification, Wi‑Fi and CPU awake even with the screen locked. It turns itself off after a
 * few minutes without requests from the PC.
 */
public class ShareService extends Service {

    static final String CHANNEL = "rj_share";
    static final int NOTIF_ID = 4712;
    static final long IDLE_MS = 8 * 60 * 1000L;

    static volatile long lastUse = 0;
    static volatile String who = "";
    static volatile boolean running = false;

    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String shownWho = "";

    /** A PC just asked for something: I start (or keep running) the service. */
    static void touch(Context ctx, String deviceName) {
        lastUse = System.currentTimeMillis();
        boolean changed = deviceName != null && !deviceName.isEmpty() && !deviceName.equals(who);
        if (changed) who = deviceName;
        if (running && !changed) return;
        try {
            Intent i = new Intent(ctx, ShareService.class);
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
        } catch (Exception ignored) {
            // Android doesn't allow starting it from the background if the app is restricted by battery saver:
            // the server answers anyway as long as the system lets it
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Tr.init(this);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, Tr.s("Music shared with the PC", "Musica condivisa con il PC"), NotificationManager.IMPORTANCE_LOW);
            ch.setDescription(Tr.s("While a PC uses this phone's music", "Mentre un PC usa la musica di questo telefono"));
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
    }

    private Notification build() {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = open == null ? null : PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String name = who == null || who.isEmpty() ? Tr.s("a PC", "un PC") : who;
        shownWho = who;
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_juke)
            .setContentTitle(Tr.s("Sharing music with " + name, "Condivido la musica con " + name))
            .setContentText(Tr.s("Works even with the screen locked", "Funziona anche a schermo bloccato"))
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
            else startForeground(NOTIF_ID, build());
        } catch (Exception e) { stopSelf(); return START_NOT_STICKY; }
        if (!running) {
            running = true;
            acquire();
            handler.postDelayed(this::check, 30000);
        } else if (!who.equals(shownWho)) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, build());
        }
        return START_NOT_STICKY;
    }

    private void acquire() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rJuke:share");
            wake.setReferenceCounted(false);
            wake.acquire(IDLE_MS + 60000);
        } catch (Exception ignored) { }
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            @SuppressWarnings("deprecation") int mode = Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wifi = wm.createWifiLock(mode, "rJuke:share");
            wifi.setReferenceCounted(false);
            wifi.acquire();
        } catch (Exception ignored) { }
        try {
            // with the screen off the “low latency” mode doesn't apply: I add the classic one too
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            @SuppressWarnings("deprecation") WifiManager.WifiLock hp = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "rJuke:share-hp");
            hp.setReferenceCounted(false);
            hp.acquire();
            wifiHp = hp;
        } catch (Exception ignored) { }
    }
    private WifiManager.WifiLock wifiHp;

    private void check() {
        if (System.currentTimeMillis() - lastUse > IDLE_MS) { stopSelf(); return; }
        try { if (wake != null) wake.acquire(IDLE_MS + 60000); } catch (Exception ignored) { }
        handler.postDelayed(this::check, 30000);
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Exception ignored) { }
        try { if (wifi != null && wifi.isHeld()) wifi.release(); } catch (Exception ignored) { }
        try { if (wifiHp != null && wifiHp.isHeld()) wifiHp.release(); } catch (Exception ignored) { }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}

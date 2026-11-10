package io.github.ruoccos.rjuke;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.mp3.Mp3Extractor;
import androidx.media3.session.CommandButton;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.LibraryResult;
import androidx.media3.session.MediaLibraryService;
import androidx.media3.session.MediaSession;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionCommands;
import androidx.media3.session.SessionResult;

import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Playback service: background music, notification, lock screen and Android Auto.
 */
public class PlaybackService extends MediaLibraryService {

    static final String CMD_SHUFFLE = "rj.SHUFFLE";
    static final String CMD_REPEAT = "rj.REPEAT";
    static final String CMD_PARTY = "rj.PARTY";
    static final String CMD_QR = "rj.QR";

    // ---------- PartyBox da Android Auto ----------
    static volatile PlaybackService inst;
    static volatile boolean partyOn = false, partyQr = false;
    static volatile android.net.Uri qrArt = null;

    /** Updates buttons and cover (QR code) after a PartyBox change. From any thread. */
    static void partyUpdate() {
        PlaybackService s = inst;
        if (s == null) return;
        new Handler(Looper.getMainLooper()).post(() -> {
            if (s.session == null) return;
            Player p = s.session.getPlayer();
            s.session.setCustomLayout(s.buttons(p));
            s.applyArt(p);
        });
    }

    /** Message on the car screen (e.g. PartyBox can't start without a hotspot). */
    static void autoError(String msg) {
        lastPartyReply = System.currentTimeMillis();
        PlaybackService s = inst;
        if (s == null) return;
        new Handler(Looper.getMainLooper()).post(() -> {
            if (s.session == null) return;
            try { s.session.sendError(new androidx.media3.session.SessionError(androidx.media3.session.SessionError.ERROR_UNKNOWN, msg)); } catch (Exception ignored) { }
        });
    }

    /** While the QR code is shown, the PartyBox QR code replaces the cover of the current track. */
    void applyArt(Player p) {
        int i = p.getCurrentMediaItemIndex();
        if (i < 0 || i >= p.getMediaItemCount()) return;
        MediaItem it = p.getMediaItemAt(i);
        androidx.media3.common.MediaMetadata md = it.mediaMetadata;
        Bundle ex = md.extras != null ? new Bundle(md.extras) : new Bundle();
        boolean showing = ex.containsKey("rjArtOrig");
        boolean want = partyOn && partyQr && qrArt != null;
        android.net.Uri target;
        if (want) {
            if (showing && qrArt.equals(md.artworkUri)) return;
            if (!showing) ex.putString("rjArtOrig", md.artworkUri == null ? "" : md.artworkUri.toString());
            target = qrArt;
        } else {
            if (!showing) return;
            String o = ex.getString("rjArtOrig", "");
            ex.remove("rjArtOrig");
            target = o.isEmpty() ? null : android.net.Uri.parse(o);
        }
        androidx.media3.common.MediaMetadata nmd = md.buildUpon().setArtworkUri(target).setArtworkData(null, null).setExtras(ex).build();
        try { p.replaceMediaItem(i, it.buildUpon().setMediaMetadata(nmd).build()); } catch (Exception ignored) { }
    }

    /** PartyBox command from the car: run by the app UI (where PartyBox lives). */
    static volatile long lastPartyReply = 0;
    private void partyCommand() {
        String cmd = partyOn ? "party-stop" : "party-start";
        long asked = System.currentTimeMillis();
        boolean sent = JukePlugin.autoCommand(cmd);
        // if the app doesn't answer, I say so on the car screen instead of doing nothing
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (lastPartyReply < asked) autoError(Tr.s("rJuke isn't answering: open the app on the phone and try again", "rJuke non risponde: apri l'app sul telefono e riprova"));
        }, sent ? 10000 : 25000);
        if (sent) return;
        // app closed: I open it, and PartyBox starts as soon as it's ready
        JukePlugin.pendingAuto = cmd;
        try {
            Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (open != null) { open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(open); }
        } catch (Exception ignored) { }
    }

    private MediaLibrarySession session;
    private AutoLibrary lib;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override
    public void onCreate() {
        super.onCreate();
        lib = new AutoLibrary(this);
        inst = this;
        // Bug #6: precise seeking even in MP3s without an index and in constant-bitrate files
        DefaultExtractorsFactory extractors = new DefaultExtractorsFactory()
            .setConstantBitrateSeekingEnabled(true)
            .setConstantBitrateSeekingAlwaysEnabled(true)
            .setMp3ExtractorFlags(Mp3Extractor.FLAG_ENABLE_INDEX_SEEKING);
        DefaultMediaSourceFactory sources = new DefaultMediaSourceFactory(this, extractors);
        ExoPlayer player = new ExoPlayer.Builder(this, sources)
            .setAudioAttributes(
                new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .build();

        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        DefaultMediaNotificationProvider provider = new DefaultMediaNotificationProvider.Builder(this).build();
        provider.setSmallIcon(R.drawable.ic_stat_juke);
        setMediaNotificationProvider(provider);

        // MP3 without a header carrying the duration: the player doesn't know it, so Android Auto shows no progress bar.
        // The library's duration (read from the tags) is used until the player works it out itself.
        Player shown = new ForwardingPlayer(player) {
            private long known(long d) {
                if (d != C.TIME_UNSET) return d;
                MediaItem it = getCurrentMediaItem();
                Long k = it != null ? it.mediaMetadata.durationMs : null;
                return k != null && k > 0 ? k : d;
            }
            @Override public long getDuration() { return known(super.getDuration()); }
            @Override public long getContentDuration() { return known(super.getContentDuration()); }
        };
        session = new MediaLibrarySession.Builder(this, shown, new Callback())
            .setSessionActivity(pi)
            .build();
        session.setCustomLayout(buttons(player));
        player.addListener(new Player.Listener() {
            @Override
            public void onShuffleModeEnabledChanged(boolean shuffle) { session.setCustomLayout(buttons(player)); }
            @Override
            public void onRepeatModeChanged(int mode) { session.setCustomLayout(buttons(player)); }
            @Override
            public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
                if (partyOn) { Player pl = player; new Handler(Looper.getMainLooper()).post(() -> applyArt(pl)); }
            }
        });
    }

    /** “Shuffle” and “Repeat” buttons in the Android Auto player, with icons showing their state. */
    private ImmutableList<CommandButton> buttons(Player p) {
        int rm = p.getRepeatMode();
        CommandButton shuffle = new CommandButton.Builder()
            .setDisplayName(p.getShuffleModeEnabled() ? Tr.s("Shuffle on", "Riproduzione casuale attiva") : Tr.s("Shuffle off", "Riproduzione casuale disattivata"))
            .setIconResId(p.getShuffleModeEnabled() ? R.drawable.ic_aa_shuffle_on : R.drawable.ic_aa_shuffle_off)
            .setSessionCommand(new SessionCommand(CMD_SHUFFLE, Bundle.EMPTY))
            .build();
        CommandButton repeat = new CommandButton.Builder()
            .setDisplayName(rm == Player.REPEAT_MODE_ONE ? Tr.s("Repeat: one track", "Ripeti: un brano") : rm == Player.REPEAT_MODE_ALL ? Tr.s("Repeat: all", "Ripeti: tutto") : Tr.s("Repeat: off", "Ripeti: no"))
            .setIconResId(rm == Player.REPEAT_MODE_ONE ? R.drawable.ic_aa_repeat_one : rm == Player.REPEAT_MODE_ALL ? R.drawable.ic_aa_repeat_on : R.drawable.ic_aa_repeat_off)
            .setSessionCommand(new SessionCommand(CMD_REPEAT, Bundle.EMPTY))
            .build();
        CommandButton party = new CommandButton.Builder()
            .setDisplayName(partyOn ? Tr.s("End PartyBox", "Termina PartyBox") : Tr.s("Start PartyBox", "Avvia PartyBox"))
            .setIconResId(partyOn ? R.drawable.ic_aa_party_stop : R.drawable.ic_aa_party)
            .setSessionCommand(new SessionCommand(CMD_PARTY, Bundle.EMPTY))
            .build();
        if (!partyOn) return ImmutableList.of(shuffle, repeat, party);
        CommandButton qr = new CommandButton.Builder()
            .setDisplayName(partyQr ? Tr.s("Hide QR", "Nascondi QR") : Tr.s("Show QR", "Mostra QR"))
            .setIconResId(partyQr ? R.drawable.ic_aa_qr : R.drawable.ic_aa_qr_off)
            .setSessionCommand(new SessionCommand(CMD_QR, Bundle.EMPTY))
            .build();
        return ImmutableList.of(shuffle, repeat, party, qr);
    }

    // ---------- steering wheel / headphone controls: short press = change track, hold = seek forward/back within the track ----------
    // Media3 only passes “pressed” events to the app (never “released”): Android Auto sends a first “pressed”
    // and, if the key stays down, a second “pressed” with the long-press flag. So:
    // - on the first event I wait a moment before changing track;
    // - if the long-press flag arrives, no track change: I seek forward (or back) within the track,
    // one step for each “held” signal that arrives. There is no automatic seeking: it always stops on its own.
    private static final long SEEK_STEP = 10000, MIN_STEP_GAP = 250;
    private final Handler keys = new Handler(Looper.getMainLooper());
    private int pendingKey = 0;
    private Player pendingPlayer;
    private long lastStepAt = 0;
    private final Runnable pendingSkip = new Runnable() {
        @Override public void run() {
            Player p = pendingPlayer; int k = pendingKey;
            pendingKey = 0; pendingPlayer = null;
            if (p == null || k == 0) return;
            if (k == KeyEvent.KEYCODE_MEDIA_NEXT) p.seekToNext(); else p.seekToPrevious();
        }
    };
    private void stopHold() { keys.removeCallbacks(pendingSkip); pendingKey = 0; pendingPlayer = null; }
    private static long longWait() { return Math.max(500, android.view.ViewConfiguration.getLongPressTimeout()) + 300; }

    @SuppressWarnings("deprecation")
    private boolean onSkipKey(MediaSession s, Intent intent) {
        KeyEvent ev = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent.class) : intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
        if (ev == null || ev.getAction() != KeyEvent.ACTION_DOWN) return false;
        int k = ev.getKeyCode();
        if (k != KeyEvent.KEYCODE_MEDIA_NEXT && k != KeyEvent.KEYCODE_MEDIA_PREVIOUS) return false;
        Player p = s.getPlayer();
        boolean held = ev.getRepeatCount() > 0 || (ev.getFlags() & KeyEvent.FLAG_LONG_PRESS) != 0;
        if (!held) {
            // new press: if one was already pending (two quick taps) I run it right away
            if (pendingKey != 0) { keys.removeCallbacks(pendingSkip); pendingSkip.run(); }
            pendingKey = k; pendingPlayer = p;
            keys.postDelayed(pendingSkip, longWait());
            return true;
        }
        // held down: no track change, one step within the track
        if (pendingKey == k) stopHold();
        long now = System.currentTimeMillis();
        if (now - lastStepAt < MIN_STEP_GAP) return true;
        lastStepAt = now;
        long dur = p.getDuration(), pos = p.getCurrentPosition();
        long to = k == KeyEvent.KEYCODE_MEDIA_NEXT ? pos + SEEK_STEP : Math.max(0, pos - SEEK_STEP);
        if (dur != C.TIME_UNSET && dur > 0) to = Math.min(to, Math.max(0, dur - 1500));
        p.seekTo(to);
        return true;
    }

    private class Callback implements MediaLibrarySession.Callback {

        @Override
        public boolean onMediaButtonEvent(@NonNull MediaSession s, @NonNull MediaSession.ControllerInfo c, @NonNull Intent intent) {
            // notification buttons only send “pressed”: I let them be handled as usual
            if (s.isMediaNotificationController(c)) return false;
            return onSkipKey(s, intent);
        }

        @NonNull
        @Override
        public MediaSession.ConnectionResult onConnect(@NonNull MediaSession s, @NonNull MediaSession.ControllerInfo controller) {
            SessionCommands cmds = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
                .add(new SessionCommand(CMD_SHUFFLE, Bundle.EMPTY))
                .add(new SessionCommand(CMD_REPEAT, Bundle.EMPTY))
                .add(new SessionCommand(CMD_PARTY, Bundle.EMPTY))
                .add(new SessionCommand(CMD_QR, Bundle.EMPTY))
                .build();
            return new MediaSession.ConnectionResult.AcceptedResultBuilder(s)
                .setAvailableSessionCommands(cmds)
                .setCustomLayout(buttons(s.getPlayer()))
                .build();
        }

        @NonNull
        @Override
        public ListenableFuture<SessionResult> onCustomCommand(@NonNull MediaSession s, @NonNull MediaSession.ControllerInfo c, @NonNull SessionCommand cmd, @NonNull Bundle args) {
            Player p = s.getPlayer();
            if (CMD_SHUFFLE.equals(cmd.customAction)) p.setShuffleModeEnabled(!p.getShuffleModeEnabled());
            else if (CMD_REPEAT.equals(cmd.customAction)) {
                int rm = p.getRepeatMode();
                p.setRepeatMode(rm == Player.REPEAT_MODE_OFF ? Player.REPEAT_MODE_ALL : rm == Player.REPEAT_MODE_ALL ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
            }
            else if (CMD_PARTY.equals(cmd.customAction)) partyCommand();
            else if (CMD_QR.equals(cmd.customAction)) {
                partyQr = !partyQr;
                s.setCustomLayout(buttons(p));
                applyArt(p);
            }
            return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
        }

        @NonNull
        @Override
        public ListenableFuture<LibraryResult<MediaItem>> onGetLibraryRoot(@NonNull MediaLibrarySession s, @NonNull MediaSession.ControllerInfo b, @Nullable LibraryParams params) {
            Bundle extras = AutoLibrary.hints(AutoLibrary.GRID, AutoLibrary.LIST);
            extras.putBoolean(AutoLibrary.CONTENT_STYLE_SUPPORTED, true);
            extras.putBoolean(AutoLibrary.SEARCH_SUPPORTED, true);
            LibraryParams out = new LibraryParams.Builder().setExtras(extras).build();
            return Futures.immediateFuture(LibraryResult.ofItem(lib.root(), out));
        }

        @NonNull
        @Override
        public ListenableFuture<LibraryResult<MediaItem>> onGetItem(@NonNull MediaLibrarySession s, @NonNull MediaSession.ControllerInfo b, @NonNull String mediaId) {
            return run(() -> {
                MediaItem it = lib.item(mediaId);
                return it != null ? LibraryResult.ofItem(it, null) : LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE);
            });
        }

        @NonNull
        @Override
        public ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> onGetChildren(@NonNull MediaLibrarySession s, @NonNull MediaSession.ControllerInfo b, @NonNull String parentId, int page, int pageSize, @Nullable LibraryParams params) {
            return run(() -> LibraryResult.ofItemList(paged(lib.children(parentId), page, pageSize), params));
        }

        @NonNull
        @Override
        public ListenableFuture<LibraryResult<Void>> onSearch(@NonNull MediaLibrarySession s, @NonNull MediaSession.ControllerInfo b, @NonNull String query, @Nullable LibraryParams params) {
            io.execute(() -> {
                int n = lib.search(query).size();
                s.notifySearchResultChanged(b, query, n, params);
            });
            return Futures.immediateFuture(LibraryResult.ofVoid());
        }

        @NonNull
        @Override
        public ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> onGetSearchResult(@NonNull MediaLibrarySession s, @NonNull MediaSession.ControllerInfo b, @NonNull String query, int page, int pageSize, @Nullable LibraryParams params) {
            return run(() -> LibraryResult.ofItemList(paged(lib.search(query), page, pageSize), params));
        }

        @NonNull
        @Override
        public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onSetMediaItems(@NonNull MediaSession s, @NonNull MediaSession.ControllerInfo c, @NonNull List<MediaItem> items, int startIndex, long startPositionMs) {
            // from the car: a chosen track becomes the queue of its whole album/playlist, starting from there
            if (items.size() == 1) {
                MediaItem it = items.get(0);
                String id = it.mediaId;
                String query = it.requestMetadata.searchQuery;
                if (query != null || id.isEmpty()) {
                    return run(() -> {
                        List<MediaItem> q = lib.playFromSearch(query, it.requestMetadata.extras);
                        if (q.isEmpty()) throw new IllegalStateException(Tr.s("No track found for “" + query + "”", "Nessun brano trovato per «" + query + "»"));
                        return new MediaSession.MediaItemsWithStartPosition(q, 0, C.TIME_UNSET);
                    });
                }
                if (id.startsWith("play|shuffle:")) {
                    // shuffle on playlist/album/artist: full queue, random first track and shuffle mode on
                    return run(() -> {
                        List<MediaItem> q = lib.resolveOrdered(id);
                        if (q.isEmpty()) throw new IllegalStateException(Tr.s("Nothing to play", "Niente da riprodurre"));
                        int st = new java.util.Random().nextInt(q.size());
                        new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> { Player p = s.getPlayer(); p.setShuffleModeEnabled(true); });
                        return new MediaSession.MediaItemsWithStartPosition(q, st, C.TIME_UNSET);
                    });
                }
                if (id.startsWith("play|")) {
                    return run(() -> {
                        List<MediaItem> q = lib.resolveOrdered(id);
                        int st = id.contains("shuffle-all") ? 0 : Math.min(Math.max(0, lib.resolveStart(id)), Math.max(0, q.size() - 1));
                        return new MediaSession.MediaItemsWithStartPosition(q, st, C.TIME_UNSET);
                    });
                }
                if (id.startsWith("album:") || id.startsWith("pl:") || id.startsWith("artist:")) {
                    return run(() -> new MediaSession.MediaItemsWithStartPosition(lib.resolveOrdered("play|" + id + "|0"), 0, C.TIME_UNSET));
                }
            }
            return run(() -> new MediaSession.MediaItemsWithStartPosition(fill(items), startIndex, startPositionMs));
        }

        @NonNull
        @Override
        public ListenableFuture<List<MediaItem>> onAddMediaItems(@NonNull MediaSession s, @NonNull MediaSession.ControllerInfo c, @NonNull List<MediaItem> items) {
            return run(() -> fill(items));
        }
    }

    /** Fills in items that arrive without a file address (e.g. from the car). The app already sends complete items. */
    private List<MediaItem> fill(List<MediaItem> items) {
        List<MediaItem> out = new ArrayList<>();
        for (MediaItem it : items) {
            if (it.localConfiguration != null) { out.add(it); continue; }
            if (it.mediaId.startsWith("play|")) { out.addAll(lib.resolveOrdered(it.mediaId)); continue; }
            MediaItem r = lib.item(it.mediaId);
            if (r != null && r.localConfiguration != null) out.add(r);
        }
        return out;
    }

    private static ImmutableList<MediaItem> paged(List<MediaItem> all, int page, int pageSize) {
        if (pageSize <= 0 || pageSize >= all.size()) return ImmutableList.copyOf(all);
        int from = Math.max(0, page) * pageSize;
        if (from >= all.size()) return ImmutableList.of();
        return ImmutableList.copyOf(all.subList(from, Math.min(all.size(), from + pageSize)));
    }

    private interface Job<V> { V call() throws Exception; }

    private <V> ListenableFuture<V> run(Job<V> job) {
        com.google.common.util.concurrent.SettableFuture<V> f = com.google.common.util.concurrent.SettableFuture.create();
        io.execute(() -> {
            try { f.set(job.call()); } catch (Exception e) { f.setException(e); }
        });
        return f;
    }

    @Nullable
    @Override
    public MediaLibrarySession onGetSession(@NonNull MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        Player p = session != null ? session.getPlayer() : null;
        if (p == null || !p.getPlayWhenReady() || p.getMediaItemCount() == 0) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        if (inst == this) inst = null;
        stopHold();
        if (session != null) {
            session.getPlayer().release();
            session.release();
            session = null;
        }
        io.shutdown();
        super.onDestroy();
    }
}

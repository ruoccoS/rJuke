package io.github.ruoccos.rjuke;

import android.app.Activity;
import android.app.SearchManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;

import androidx.media3.common.MediaItem;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.MoreExecutors;

/**
 * “Ok Google, play … on rJuke” (phone and Android Auto). Passes the request to the player as a
 * search and closes right away, without showing anything.
 */
public class VoiceSearchActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String query = getIntent().getStringExtra(SearchManager.QUERY);
        Bundle extras = getIntent().getExtras() != null ? new Bundle(getIntent().getExtras()) : new Bundle();
        play(getApplicationContext(), query == null ? "" : query, extras);
        finish();
    }

    static void play(Context ctx, String query, Bundle extras) {
        SessionToken token = new SessionToken(ctx, new ComponentName(ctx, PlaybackService.class));
        ListenableFuture<MediaController> f = new MediaController.Builder(ctx, token).buildAsync();
        f.addListener(() -> {
            try {
                MediaController c = f.get();
                MediaItem item = new MediaItem.Builder()
                    .setMediaId("")
                    .setRequestMetadata(new MediaItem.RequestMetadata.Builder().setSearchQuery(query).setExtras(extras).build())
                    .build();
                c.setMediaItem(item);
                c.prepare();
                c.play();
                new android.os.Handler(c.getApplicationLooper()).postDelayed(c::release, 4000);
            } catch (Exception ignored) { }
        }, MoreExecutors.directExecutor());
    }
}

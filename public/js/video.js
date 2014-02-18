define([
   "underscore", "backbone", "logger",
   "underscore-template-config"
], function(_, Backbone, logger) {

var video = {};

if (!window.YouTubeLoadQueue) {
    window.YouTubeLoadQueue = [];
}
if (!window.onYouTubeIframeAPIReady) {
    window.onYouTubeIframeAPIReady = function() {
        _.each(window.YouTubeLoadQueue, function(params) {
            new YT.Player(params.id, params.attrs);
        });
        window.YouTubeLoadQueue = [];
    }
}
video.YoutubeVideo = Backbone.View.extend({
    tagName: "table",
    template: _.template($("#youtube-video").html()),
    controlsTemplate: _.template($("#youtube-video-controls").html()),
    DATA_API_URL: "https://gdata.youtube.com/feeds/api/videos/{id}?v=2&alt=json-in-script&callback=?",
    IFRAME_API_URL: "https://www.youtube.com/iframe_api",
    events: {
        'click .play-for-everyone': 'playForEveryone',
        'click .sync-lock': 'toggleSync',
        'click .video-settings': 'triggerVideoSettings',
    },
    initialize: function(options) {
        this.ytID = options.ytID;
        this.showGroupControls = options.showGroupControls;
        this.intendToSync = true;
        _.bindAll(this, "playForEveryone", "toggleSync",
                        "onPlayerReady", "onPlayerStateChange",
                        "triggerVideoSettings");
        this.logger = new logger.Logger("VIDEO", "error");
    },
    render: function() {
        this.$el.html(this.template({cid: this.cid}));
        window.YouTubeLoadQueue.push({
            id: 'player-' + this.cid,
            attrs: {
                width: '320',
                height: '240',
                videoId: this.ytID,
                events: {
                    onReady: this.onPlayerReady,
                    onStateChange: this.onPlayerStateChange
                },
                playerVars: { wmode: "transparent" }
            }
        });
        // Check if the YouTube API has loaded yet.  Load it if not.
        if (!window.YT) {
            var tag = document.createElement('script');
            tag.src = this.IFRAME_API_URL;
            document.body.appendChild(tag);
        } else {
            // API is loaded already -- tell it to run the load queue.
            window.onYouTubeIframeAPIReady();
        }
        this.renderControls();
    },
    renderControls: function() {
        var ctrl = this.ctrl || {};
        this.$(".video-controls").html(this.controlsTemplate({
            playing: ctrl.state == "playing",
            synced: this.isSynced(),
            showGroupControls: this.showGroupControls,
            intendToSync: this.intendToSync,
            syncAvailable: this.syncAvailable()
        }));
    },
    setVideoId: function(id) {
        if (id != this.ytID) {
            this.ytID = id;
            this.render();
        }
    },
    syncAvailable: function() {
        return (!!this.ctrl) && (new Date().getTime() - this.timeOfLastControl) < 5000 && (this.ctrl.state == "playing");
    },
    isSynced: function() {
        return this.syncAvailable() && this.playStatusSynced() && this.timeSynced();
    },
    timeSynced: function() {
        return this.player && (Math.abs(this.ctrl.time - this.player.getCurrentTime()) < 10);
    },
    playStatusSynced: function() {
        return this.player && (
            (this.ctrl.state == "playing") == (this.player.getPlayerState() == YT.PlayerState.PLAYING)
        );
    },
    receiveControl: function(args) {
        this.logger.debug("Receive control", args.state);
        this.timeOfLastControl = new Date().getTime();
        this.ctrl = args;
        if (!this.player) { return; }
        // Do we have no intention of syncing?  Return.
        if (!this.intendToSync) {
            this.renderControls();
            return;
        }
        // Has the video finished? Tell the server to pause.
        var dur = this.player.getDuration();
        if (args.state == "playing" && dur > 0 && args.time > dur) {
            this.trigger("control-video", {action: "pause"});
        }
        // Sync us up!
        if (!this.timeSynced()) {
            this.player.seekTo(args.time);
        }
        if (!this.playStatusSynced()) {
            if (this.player.getPlayerState() != YT.PlayerState.BUFFERING) {
                if (args.state == "playing") {
                    this.player.playVideo();
                } else {
                    this.player.pauseVideo();
                }
            }
        }
        this.renderControls();
    },
    onPlayerReady: function(event) {
        this.player = event.target;
        // Fix for z-index issues -- see http://stackoverflow.com/a/9074366
        this.$("iframe").attr("wmode", "Opaque");
    },
    onPlayerStateChange: function(event) {
        this.renderControls();
        this.logger.debug("onPlayerStateChange", event.data);
        // Google gives us no "onSeekTo" or seek-related player state change,
        // so we have to be a little tricky about figuring out if someone has
        // tried to seek to elsewhere in the video.
        //
        // If we get a pause signal ...
        if (event.data == YT.PlayerState.PAUSED &&
                // ... when 'sync' enabled ...
                this.intendToSync &&
                // ... and the video is playing ...
                this.syncAvailable()) {
            // ... interpret it as an intention to seek or pause.
            this.logger.debug("times", this.ctrl.time, this.player.getCurrentTime());
            if (this.showGroupControls) {
                // Admin: do it for everyone.
                // If it's more than 10 seconds, assume seek; otherwise pause. 
                if (Math.abs(this.ctrl.time  - this.player.getCurrentTime()) > 10) {
                    this.logger.debug("send control-video play");
                    if (this._seekPauseTimeout) {
                        this.logger.debug("clear seekPauseTimeout: seeking");
                        clearTimeout(this._seekPauseTimeout);
                    }
                    this.trigger("control-video", {
                        action: "play",
                        time: this.player.getCurrentTime()
                    });
                } else {
                    // Can't find any reasonable way to distinguish intentional
                    // pauses from unintentional pauses.  YouTube throws pause
                    // signals (sometimes more than one) whenever play is
                    // interrupted, either from a seek, a reversion to
                    // buffering, or whatever.  Essentially disabling the
                    // native pause control for admins/breakout participants as
                    // a result.
                }
            } else {
                // Non-admin: just toggle intendToSync.
                this.toggleSync();
            }
        }
    },
    getTitle: function(callback) {
        var url = this.DATA_API_URL.replace("{id}", this.ytID);
        $.getJSON(url, _.bind(function(data) {
            callback(data.entry.title.$t);
        }, this));
    },
    playForEveryone: function(event) {
        if (event) { event.preventDefault(); }
        var playing = this.ctrl && this.ctrl.state == "playing";
        var args;
        if (playing) {
            args = {action: "pause"};
        } else {
            var dur = this.player.getDuration();
            if (this.player.getCurrentTime() >= dur) {
                time = 0;
            } else {
                time = this.player.getCurrentTime();
            }
            args = {action: "play", time: time};
        }
        this.trigger("control-video", args);
    },
    toggleSync: function(event) {
        if (event) { event.preventDefault(); }
        if (this.intendToSync) {
            this.intendToSync = false;
            this.renderControls();
        } else {
            this.intendToSync = true;
            if (this.ctrl) {
                this.receiveControl(this.ctrl);
            }
        }
    },
    triggerVideoSettings: function(event) {
        this.trigger("video-settings", this);
    }
});

return video;

});

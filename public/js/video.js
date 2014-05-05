define([
   "underscore", "jquery", "backbone", "logger", "extract-youtube-id",
   "underscore-template-config"
], function(_, $, Backbone, logger, extractYoutubeId) {

var DATA_API_URL = "https://gdata.youtube.com/feeds/api/videos/{id}?v=2&alt=json-in-script&callback=?",
    IFRAME_API_URL = "https://www.youtube.com/iframe_api",
    video = {};

if (!window.YouTubeLoadQueue) {
    window.YouTubeLoadQueue = [];
}
if (!window.onYouTubeIframeAPIReady) {
    window.onYouTubeIframeAPIReady = function() {
        _.each(window.YouTubeLoadQueue, function(params) {
            new YT.Player(params.id, params.attrs);
        });
        window.YouTubeLoadQueue = [];
    };
}


var VIDEO_DETAILS_CACHE = {};
video.getVideoDetails = function(id, callback) {
    if (id in VIDEO_DETAILS_CACHE) {
        return callback(VIDEO_DETAILS_CACHE[id]);
    }
    $.getJSON(
        DATA_API_URL.replace("{id}", id)
    ).done(function(data) {
        VIDEO_DETAILS_CACHE[id] = {
            id: id,
            title: data.entry.title.$t,
            duration: parseInt(data.entry.media$group.yt$duration.seconds),
            thumbnail: data.entry.media$group.media$thumbnail[0]
        };
    }).fail(function() {
        VIDEO_DETAILS_CACHE[id] = null;
    }).always(function() {
        callback(VIDEO_DETAILS_CACHE[id]);
    });


};

video.extractYoutubeId = extractYoutubeId.extractYoutubeId;

video.YoutubeVideo = Backbone.View.extend({
    tagName: "table",
    template: _.template($("#youtube-video").html()),
    controlsTemplate: _.template($("#youtube-video-controls").html()),
    events: {
        'click .play-for-everyone': 'playForEveryone',
        'click .sync-lock': 'toggleSync',
        'click .video-settings': 'triggerVideoSettings',
    },
    initialize: function(options) {
        this.ytID = options.ytID;
        this.showGroupControls = options.showGroupControls;
        this.permitGroupControl = options.permitGroupControl;
        this.intendToSync = true;
        _.bindAll(this, "playForEveryone", "toggleSync",
                        "onPlayerReady", "onPlayerStateChange",
                        "triggerVideoSettings");
        this.logger = new logger.Logger("VIDEO", "debug");
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
            tag.src = IFRAME_API_URL;
            document.body.appendChild(tag);
        } else {
            // API is loaded already -- tell it to run the load queue.
            window.onYouTubeIframeAPIReady();
        }
        this.renderControls();
        if (this.permitGroupControl) {
            setInterval(_.bind(this.renderTime, this), 500);
        }
    },
    renderControls: function() {
        this.$(".video-controls").html(this.controlsTemplate({
            playing: this.isPlayingForEveryone(),
            awaitingStart: this.isAwaitingStart(),
            synced: this.isSynced(),
            showGroupControls: this.showGroupControls,
            intendToSync: this.intendToSync,
            syncAvailable: this.isSyncAvailable()
        }));
        this.trigger("renderControls");
    },
    renderTime: function() {
        var time;
        var formatTime = function(seconds) {
            var hours = parseInt(seconds / (60 * 60));
            var minutes = parseInt((seconds % 3600) / 60);
            var seconds = parseInt(seconds % 60);
            hours = (hours > 0 ? hours + ":" : "");
            minutes = ((hours && (minutes < 10)) ? "0" : "") + minutes + ":";
            seconds = (seconds < 10 ? "0" : "") + seconds;
            return hours + minutes + seconds;
        };
        if (this.ctrl) {
            if (this.ctrl.state === "playing") {
                time = formatTime(this.ctrl.time +
                                  (Date.now() - this.ctrl.localBegin) / 1000);
            } else if (this.ctrl.state === "paused") {
                if (!this.player) {
                    time = "";
                } else {
                    time = formatTime(this.player.getCurrentTime());
                }
            }
        } else {
            time = "";
        }
        this.$(".time-indicator").html(time);
        this.trigger("render-time", time);
    },
    setVideoId: function(id) {
        if (id != this.ytID) {
            this.ytID = id;
            this.render();
        }
    },
    isSyncAvailable: function() {
        return !!this.ctrl && this.ctrl.state === "playing";
    },
    isSynced: function() {
        return this.isSyncAvailable() && this.isPlayStatusSynced() && this.isTimeSynced();
    },
    isTimeSynced: function() {
        if (!this.player) {
            return false;
        }
        if (this.ctrl.state === "playing") {
            // How long since the control signal told us to begin, in seconds?
            var diff = (Date.now() - this.ctrl.localBegin) / 1000;
            // Use that diff to figure out where we ought to be in the video.
            var expected = this.ctrl.time + diff;
            // Consider us synced if we're within 10 seconds of that.
            return Math.abs(expected - this.player.getCurrentTime()) < 10
        } else {
            return true;
        }
    },
    isPlayStatusSynced: function() {
        return this.player && (
            (this.ctrl.state == "playing") == (this.player.getPlayerState() == YT.PlayerState.PLAYING)
        );
    },
    receiveControl: function(args) {
        this.logger.debug("Receive control", args.state, args);
        //
        // Mute control: out-of-band from regular video sync. Currently only
        // triggered by joining a hangout-on-air for which this is the embed.
        //
        if (args.mute === true || args.mute === false) {
            return this.handleMute(args.mute);
        }
        //
        // Regular video sync.
        //
        this.ctrl = args;
        if (args.localBegin === undefined) {
            this.ctrl.localBegin = Date.now();
        }
        if (!this.player) {
            // If we don't have a player yet, delay until it's ready.
            setTimeout(_.bind(function() {
                this.logger.debug("player not ready yet, delaying.");
                this.receiveControl(args);
            }, this), 1000);
            return;
        }
        // Do we have no intention of syncing?  Return.
        if (!this.intendToSync) {
            this.renderControls();
            return;
        }
        if (args.state === "paused" || args.state === "playing") {
            // Cancel polling for the video to start if someone else has
            // triggered play.
            this.cancelPollForStart();
        }
        // Has the video finished? Tell the server to pause.
        var dur = this.player.getDuration();
        if (args.state === "playing" && dur > 0 && args.time > dur) {
            this.logger.info("Pausing, video is over");
            if (this.permitGroupControl) {
                this.logger.info("Telling server to pause.");
                this.trigger("control-video", {action: "pause"});
            } else {
                this.logger.debug("Not telling server to pause - not permitted.");
            }
            this.player.pauseVideo();
            return;
        }
        if (!this.isPlayStatusSynced()) {
            if (args.state === "playing") {
                this.logger.debug("Playing");
                this.player.playVideo();
                this.once("player-state-playing", _.bind(this.syncTime, this));
            } else {
                this.logger.debug("Pausing");
                this.player.pauseVideo();
            }
        } else if (args.state === "playing") {
            this.syncTime();
        }

        this.renderControls();
    },
    syncTime: function() {
        if (!this.isTimeSynced()) {
            var curTime = this.ctrl.time + (Date.now() - this.ctrl.localBegin) / 1000;
            this.logger.debug("Seeking to", curTime);
            this.player.seekTo(curTime, true);
        }
    },
    handleMute: function(mute) {
        if (!this.player) {
            // This is a slightly ugly, slightly dangerous hack -- if we get a
            // mute request, but the player isn't ready yet, delay 100ms and
            // try again.
            return setTimeout(_.bind(function() {
                this.handleMute(mute);
            }, this), 100);
        }
        if (mute) {
            this.player.mute();
        } else {
            this.player.unMute();
        }
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
                this.isSyncAvailable()) {
            // ... interpret it as an intention to seek or pause.
            this.logger.debug("times", this.ctrl.time, this.player.getCurrentTime());
            if (this.ctrl.state === "playing" && Math.abs(
                    this.player.getDuration() - this.ctrl.time) > 10) {
                this.toggleSync();
            }
        }
        // Trigger report of human-readable state.
        var state;
        switch (event.data) {
            case YT.PlayerState.PAUSED:
                state = "paused";
                break;
            case YT.PlayerState.PLAYING:
                state = "playing";
                break;
            case YT.PlayerState.BUFFERING:
                state = "buffering";
                break;
            case YT.PlayerState.CUED:
                state = "cued";
                break;
            case YT.PlayerState.ENDED:
                state = "ended";
                break;
        }
        this.trigger("player-state-change", state);
        this.trigger("player-state-" + state);
    },
    playForEveryone: function(event) {
        if (event) { event.preventDefault(); }
        var playing = this.isPlayingForEveryone();
        var awaitingStart = this.isAwaitingStart();
        var args;
        if (playing || awaitingStart) {
            args = {action: "pause"};
            this.cancelPollForStart();
        } else {
            var dur = this.player.getDuration();
            if (dur === 0) {
                this.pollForStart();
                // Don't trigger any server-side control yet; but *do* start
                // the player, so we get notified when its state changes.  If
                // we pause, it'll get paused by the "control-video" broadcast.
                this.player.playVideo();
                this.renderControls();
                return;
            } else {
                if (this.player.getCurrentTime() >= dur) {
                    time = 0;
                } else {
                    time = this.player.getCurrentTime();
                }
                args = {action: "play", time: time};
            }
        }
        this.trigger("control-video", args);
    },
    pollForStart: function() {
        this._awaitingStart = setInterval(_.bind(function() {
            var dur = this.player.getDuration();
            if (dur > 0) {
                this.cancelPollForStart();
                this.playForEveryone();
            }
        }, this), 100);
    },
    cancelPollForStart: function() {
        if (this._awaitingStart) {
            clearInterval(this._awaitingStart);
        }
        this._awaitingStart = null;
    },
    isAwaitingStart: function() {
        return !!this._awaitingStart;
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
    },
    isPlayingForEveryone: function() {
        return this.ctrl && this.ctrl.state === "playing";
    }
});

return video;

});

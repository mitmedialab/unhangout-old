define([
   "underscore", "jquery", "backbone", "logger", "extract-youtube-id", 
   "underscore-template-config"
], function(_, $, Backbone, logger, extractYoutubeId) {

var DATA_API_URL = "/youtube/video-data/{id}",
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
    // TODO: Rewrite this for server side processing with v3 of the the YouTube
    // API.
    $.getJSON(
        DATA_API_URL.replace("{id}", id)
    ).done(function(data) {
        VIDEO_DETAILS_CACHE[id] = {
            id: id,
            title: data.title,
            //duration: parseInt(data.entry.media$group.yt$duration.seconds),
            thumbnail: data.image
        };
    }).fail(function() {
        VIDEO_DETAILS_CACHE[id] = null;
    }).always(function() {
        callback(VIDEO_DETAILS_CACHE[id]);
    });


};

video.extractYoutubeId = extractYoutubeId.extractYoutubeId;

video.YoutubeVideo = Backbone.View.extend({
    tagName: "div",
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
                playerVars: {
                  wmode: "transparent",
                  controls: 0,
                  showinfo: 0,
                  rel: 0,
                  modestbranding: 1
                }
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
        setInterval(_.bind(this.renderTime, this), 500);
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
                time = formatTime(this.getCurSyncSeconds());
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
        var curSyncTime = this.getCurSyncSeconds();
        if (curSyncTime !== null) {
            return Math.abs(curSyncTime - this.player.getCurrentTime()) < 10
        } else {
            return true;
        }
    },
    isPlayStatusSynced: function() {
        return this.player && (
            (this.ctrl.state == "playing") == (this.player.getPlayerState() == YT.PlayerState.PLAYING)
        );
    },
    getCurSyncSeconds: function() {
        // Return the current sync time of the playing video, or null if none.
        if (this.isSyncAvailable()) {
            return this.ctrl.time + (Date.now() - this.ctrl.localBegin) / 1000;
        }
        return null;
    },
    receiveControl: function(args) {
        this.logger.debug("Receive control", args.state, args);

        // Mute control: out-of-band from regular video sync. Currently only
        // triggered by joining a hangout-on-air for which this is the embed.
        if (args.mute === true || args.mute === false) {
            this.handleMute(args.mute);
            // If this is a mute, return to skip all other play control logic.
            return;
        }
        
        // Discard earlier delayed control if any, to ensure that quick button
        // presses don't throw a not-ready player into confusion.
        if (this._receiveControlTimeout) {
            this.logger.debug("Replacing previous ctrl with", args);
            clearTimeout(this._receiveControlTimeout);
            this._receiveControlTimeout = null;
        }
        //
        // Regular video sync.
        //
        this.ctrl = args;
        if (args.localBegin === undefined) {
            this.ctrl.localBegin = Date.now();
        }
        if (!this.player || video.extractYoutubeId(this.player.getVideoUrl()) != this.ytID) {
            // If the player isn't ready yet, and this is a play signal, delay
            // until it's ready.  If it's a pause signal, just ignore.
            if (args.state === "playing") {
                this.logger.debug("player not ready yet, delaying.");
                this._receiveControlTimeout = setTimeout(_.bind(function() {
                    this.receiveControl(args);
                }, this), 1000);
            } else {
                this.logger.debug("ignoring pause before player is ready.");
            }
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
        if (!this.isPlayStatusSynced()) {
            if (args.state === "playing") {
                this.logger.debug("Playing");
                this.player.playVideo();
                // `syncTime` only works correctly if the player is playing.
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
            var curSyncTime = this.getCurSyncSeconds();
            if (curSyncTime !== null) {
                this.logger.debug("Seeking to", curSyncTime);
                this.player.seekTo(curSyncTime, true);
            }
        }
    },
    handleMute: function(mute) {
        if (!this.player) {
            // This is a slightly ugly hack -- if we get a mute request, but
            // the player isn't ready yet, delay 100ms and try again.  The
            // failure mode for this is to be force-muted more than you intend
            // to, which is preferable to the other way around.
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
        // Google gives us no "onSeekTo" or seek-related player state change,
        // which might be nice for shared scrubbing. All of this is overloaded
        // on `pause`.
        //
        // If we get a pause signal and the video is playing ...
        if (event.data == YT.PlayerState.PAUSED && this.isSyncAvailable()) {
            // Has the video finished? Tell the server to pause.
            var curSyncTime = this.getCurSyncSeconds();
            var dur = this.player.getDuration();
            var closeEnoughToEnd = dur > 0 && Math.abs(curSyncTime - dur) < 10;
            if (this.isTimeSynced() && closeEnoughToEnd) {
                this.logger.info("Pausing, video is over");
                if (this.permitGroupControl) {
                    this.logger.info("Telling server to pause.");
                    this.trigger("control-video", {action: "pause"});
                } else {
                    this.logger.debug("Not telling server to pause - not permitted.");
                }
                this.player.pauseVideo();
            } else if (this.intendToSync) {
                // ... interpret it as an intention to seek or pause.
                this.logger.debug("times", this.ctrl.time, this.player.getCurrentTime());
                if (this.ctrl.state === "playing" && Math.abs(
                        this.player.getDuration() - curSyncTime) > 10) {
                    this.toggleSync();
                }
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
        this.logger.debug("onPlayerStateChange", event.data, state);
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

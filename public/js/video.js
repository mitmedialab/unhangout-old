define([
   "underscore", "jquery", "backbone", "logger",
   "underscore-template-config"
], function(_, $, Backbone, logger) {

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
    if (VIDEO_DETAILS_CACHE[id]) {
        return callback(VIDEO_DETAILS_CACHE[id]);
    }
    var url = DATA_API_URL.replace("{id}", id);
    $.getJSON(url, _.bind(function(data) {
        VIDEO_DETAILS_CACHE[id] = {
            id: id,
            title: data.entry.title.$t,
            duration: parseInt(data.entry.media$group.yt$duration.seconds),
            thumbnail: data.entry.media$group.media$thumbnail[0]
        };
        callback(VIDEO_DETAILS_CACHE[id]);
    }, this));
};

// From http://stackoverflow.com/a/6904504 , covering any of the 15 or so
// different variations on youtube URLs.  Also works permissively on full
// iframe/object embed codes.  Returns empty string if empty string is given;
// returns null if no valid ID is found; otherwise, returns the 11 character
// YouTube ID.
video.extractYoutubeId = function(val) {
    if (val === "") {
        return "";
    }
    var ytid;
    if (/^[-A-Za-z0-9_]{11}$/.test(val)) {
        ytid = val;
    } else {
        var re = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/i;
        var match = re.exec(val);
        if (match) {
            ytid = match[1];
        } else {
            ytid = null;
        }
    }
    return ytid;
};

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
        this.trigger("renderControls");
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
                this.syncAvailable()) {
            // ... interpret it as an intention to seek or pause.
            this.logger.debug("times", this.ctrl.time, this.player.getCurrentTime());
            if (this.permitGroupControl) {
                // We'd like to offer admin's means to control video through
                // the native controls -- but it seems to be fraught, in at
                // least two ways: first, admins might inadvertently control
                // the video for others by clicking, not thinking that it will
                // change the video for everyone. Second, unintentional events
                // (e.g. network lags) might look like intentional control
                // events -- we can't distinguish those.
                //
                // As an example, we can't find any reasonable way to
                // distinguish intentional pauses from unintentional pauses.
                // YouTube throws pause signals (sometimes more than one)
                // whenever play is interrupted, either from a seek, a
                // reversion to buffering, or whatever.
                //
                // As a result, we're essentially disabling pause and seek for
                // admins.  For non-admins, we just un-sync.
            } else {
                // Non-admin: just toggle intendToSync, but only if we're not
                // at the end of the video.
                if (this.ctrl.state === "playing" && Math.abs(
                        this.player.getDuration() - this.ctrl.time) > 10) {
                    this.toggleSync();
                }
            }
        }
    },
    playForEveryone: function(event) {
        if (event) { event.preventDefault(); }
        var playing = this.isPlayingForEveryone();
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
    },
    isPlayingForEveryone: function() {
        return this.ctrl && this.ctrl.state === "playing";
    }
});

return video;

});

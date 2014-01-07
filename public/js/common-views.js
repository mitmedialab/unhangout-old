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
var YoutubeVideo = Backbone.View.extend({
    tagName: "table",
    template: _.template($("#youtube-video").html()),
    controlsTemplate: _.template($("#youtube-video-controls").html()),
    DATA_API_URL: "https://gdata.youtube.com/feeds/api/videos/{id}?v=2&alt=json-in-script&callback=?",
    IFRAME_API_URL: "https://www.youtube.com/iframe_api",
    events: {
        'click .play-for-everyone': 'playForEveryone',
        'click .mute-for-everyone': 'muteForEveryone',
        'click .sync-lock': 'toggleSync'
    },
    initialize: function(options) {
        this.ytID = options.ytID;
        this.showGroupControls = options.showGroupControls;
        this.intendToSync = true;
        _.bindAll(this, "playForEveryone", "muteForEveryone", "toggleSync",
                        "onPlayerReady", "onPlayerStateChange");
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
            muted: ctrl.muted,
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
        return this.syncAvailable() && this.playStatusSynced() && this.muteSynced() && this.timeSynced();
    },
    timeSynced: function() {
        return this.player && (Math.abs(this.ctrl.time - this.player.getCurrentTime()) < 10);
    },
    muteSynced: function() {
        return this.player && (this.ctrl.muted == this.player.isMuted());
    },
    playStatusSynced: function() {
        return this.player && (
            (this.ctrl.state == "playing") == (this.player.getPlayerState() == YT.PlayerState.PLAYING)
        );
    },
    receiveControl: function(args) {
        console.log("Receive control", args);
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
        if (!this.muteSynced()) {
            if (args.muted) {
                this.player.mute();
            } else {
                this.player.unMute();
            }
        }
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
    muteForEveryone: function(event) {
        if (event) { event.preventDefault(); }
        var muted = this.ctrl && this.ctrl.muted;
        this.trigger("control-video", {action: muted ? "unmute": "mute"});
    },
    toggleSync: function(event) {
        if (this.intendToSync) {
            this.intendToSync = false;
            this.renderControls();
        } else {
            this.intendToSync = true;
            if (this.ctrl) {
                this.receiveControl(this.ctrl);
            }
        }
    }
});

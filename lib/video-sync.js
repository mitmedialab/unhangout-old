var events = require("events"),
    _ = require("underscore");

function VideoSync() {
    this.muted = false;
    this.playing = false;
    _.bindAll(this, "start", "pause", "mute", "unmute", "tick", "control");
};

_.extend(VideoSync.prototype, events.EventEmitter.prototype, {
    start: function(seekSeconds) {
        seekSeconds = seekSeconds || 0;
        this.startTime = new Date().getTime();
        this.offset = this.startTime - (seekSeconds * 1000);
        this.playing = true;
        if (this.interval) {
            clearInterval(this.interval);
        }
        this.interval = setInterval(this.tick, 2500);
        this.tick();
        logger.debug("Starting Video");
    },
    pause: function(options) {
        this.playing = false;
        clearInterval(this.interval);
        if (!options || !options.silent) {
            this.tick();
        }
        logger.debug("Pausing video");
    },
    mute: function() {
        this.muted = true;
        this.tick();
        logger.debug("Muting video");
    },
    unmute: function() {
        this.muted = false;
        this.tick();
        logger.debug("Unmuting video");
    },
    control: function(args) {
        switch (args.action) {
            case "play":
                this.start(args.time);
                break;
            case "pause":
                this.pause();
                break;
            case "mute":
                this.mute();
                break;
            case "unmute":
                this.unmute();
                break;
        }
    },
    tick: function() {
        var args = {
            state: this.playing ? "playing" : "paused",
            muted: this.muted,
            time: (new Date().getTime() - this.offset) / 1000
        }
        logger.debug("tick", args);
        this.emit("control-video", args);
    }
});

module.exports = VideoSync;

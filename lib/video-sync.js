var events = require("events"),
    _ = require("underscore"),
    logger = require("./logging").getLogger();

function VideoSync() {
    this.playing = false;
};

_.extend(VideoSync.prototype, events.EventEmitter.prototype, {
    start: function(seekSeconds) {
        seekSeconds = seekSeconds || 0;
        this.startTime = new Date().getTime();
        this.offset = this.startTime - (seekSeconds * 1000);
        this.playing = true;
        this.emit("control-video", this.getState());
        logger.debug("Starting Video");
    },
    pause: function(options) {
        this.playing = false;
        clearInterval(this.interval);
        if (!options || !options.silent) {
            this.emit("control-video", this.getState());
        }
        logger.debug("Pausing video");
    },
    control: function(args) {
        switch (args.action) {
            case "play":
                this.start(args.time);
                break;
            case "pause":
                this.pause();
                break;
        }
    },
    getState: function() {
        var now = Date.now();
        return {
            state: this.playing ? "playing" : "paused",
            time: (now - this.offset) / 1000
        };
    },
});

module.exports = VideoSync;

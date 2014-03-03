var fs = require('fs'),
    logger = require("./logging").getLogger(),
    moment = require('moment-timezone'),
    mkdirp = require('mkdirp'),
    Promise = require("bluebird");

var BASE_DIR = __dirname + '/..';
mkdirp.sync(BASE_DIR + "/public/logs/chat");

module.exports.getLoggerForEvent = function(event) {
    // Return a logger with a writable stream for chats in an event.  Chat logs
    // are written to the public directory.  Timestamps are written according
    // to the given timezone for the event.
    var filename = BASE_DIR + event.getChatArchiveUrl();
    var timezone = event.get("timeZoneValue") || "America/New_York";
    
    var stream, newStream, closeTimeout;
    // Hold a queue of resolve/reject handlers in case we get multiple writes
    // before the stream is open.
    var streamQueue = [];
    function getOrCreateStream() {
        return new Promise(function(resolve, reject) {
            if (stream) {
                resolve(stream);
            } else {
                streamQueue.push([resolve, reject]);
            }
            if (!newStream) {
                // Start by trying to open the stream in append mode.
                newStream = fs.createWriteStream(filename, {flags: 'a', mode: 0644});
                // If that succeeds, call onOpen.
                newStream.on('open', function() {
                    var resolvereject;
                    stream = newStream;
                    newStream = null;
                    while (streamQueue.length > 0) {
                        resolvereject = streamQueue.shift();
                        resolvereject[0](stream);
                    };
                });
                newStream.on('error', function(err) {
                    while (streamQueue.length > 0) {
                        resolvereject = streamQueue.shift();
                        resolvereject[1](err);
                    }
                });
            }
        });
    };
    function closeEventually(stream) {
        if (closeTimeout) { clearTimeout(closeTimeout); }
        closeTimeout = setTimeout(function() {
            if (stream) {
                stream.end();
                stream = null;
            }
        }, 10000);
    };
    var queue = [];
    return {
        // Log chat by `user` with text `messageText`.  `timestamp` is
        // optional; defaults to now.
        log: function(user, messageText, timestamp) {
            var formattedDate;
            // Get the formatted date.
            timestamp = moment(timestamp || new Date().getTime()).tz(timezone);
            if (!timestamp.isValid()) {
                logger.error("Invalid date or timezone for event");
                formattedDate = "";
            } else {
                formattedDate = timestamp.format("YYYY MMM D h:mm:ss[]a");
            }
            getOrCreateStream().then(function(stream) {
                stream.write([
                    formattedDate,
                    user.getShortDisplayName() + ":",
                    messageText,
                ].join(" ") + "\n", 'utf8');
                closeEventually(stream);
            }).catch(function(err) {
                throw err;
            }).done(); // Use 'done' to suppress uncaught error warnings:
                       // https://github.com/petkaantonov/bluebird#error-handling
        },
        // Release the stream
        close: function(cb) {
            if (stream) {
                stream.end(null, 'utf8', cb);
                stream = null;
            }
        },
        // Return the current value of `stream`. Used for testing only.
        _getStream: function() {
            return stream;
        }
    };
}

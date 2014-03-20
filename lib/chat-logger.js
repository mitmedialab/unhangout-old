var fs = require('fs'),
    logger = require("./logging").getLogger(),
    moment = require('moment-timezone'),
    mkdirp = require('mkdirp'),
    Promise = require("bluebird");

var BASE_DIR = __dirname + '/..';
mkdirp.sync(BASE_DIR + "/public/logs/chat");

// Hold open file handles for each active event.
var openStreams = {};
// Hold a queue of resolve/reject handlers in case we get multiple writes
// before the stream is open.
var streamResolutionQueue = {};
// Hold references to streams that are opening (but not yet open)
var pendingStreams = {};
// Hold timeouts to streams that may close soon.
var closingStreams = {};

// Expose the stream holders for testing.
module.exports._queues = {
    openStreams: openStreams,
    streamResolutionQueue: streamResolutionQueue,
    pendingStreams: pendingStreams,
    closingStreams: closingStreams
};

module.exports.getLoggerForEvent = function(event) {
    // Return a logger with a writable stream for chats in an event.  Chat logs
    // are written to the public directory.  Timestamps are written according
    // to the given timezone for the event.
    var filename = BASE_DIR + event.getChatArchiveUrl();
    var timezone = event.get("timeZoneValue") || "America/New_York";
    
    // Function that returns a promise which when fulfilled contains a
    // writeable stream for the file for this event, and a method to do a
    // delayed close of that stream.
    function getOrCreateStream() {
        return new Promise(function(resolve, reject) {
            if (openStreams[filename]) {
                return resolve(openStreams[filename]);
            } else {
                if (!streamResolutionQueue[filename]) {
                    streamResolutionQueue[filename] = [];
                }
                streamResolutionQueue[filename].push([resolve, reject]);
            }
            if (!pendingStreams[filename]) {
                // Start by trying to open the stream in append mode.
                pendingStreams[filename] = fs.createWriteStream(filename, {
                    flags: 'a', mode: 0644
                });
                // If that succeeds, call onOpen.
                pendingStreams[filename].on('open', function() {
                    var resolvereject;

                    // Define a method to close this stream with a timeout, 10
                    // seconds after the last write.
                    pendingStreams[filename].closeEventually = function() {
                        if (closingStreams[filename]) {
                            clearTimeout(closingStreams[filename]);
                        }
                        closingStreams[filename] = setTimeout(function() {
                            if (openStreams[filename]) {
                                openStreams[filename].end();
                                delete openStreams[filename];
                                delete closingStreams[filename];
                            }
                        }, 10000);

                    }


                    openStreams[filename] = pendingStreams[filename];
                    while (streamResolutionQueue[filename] &&
                           streamResolutionQueue[filename].length > 0) {
                        resolvereject = streamResolutionQueue[filename].shift();
                        resolvereject[0](openStreams[filename]);
                    };
                    delete pendingStreams[filename];
                    delete streamResolutionQueue[filename];
                });

                // Error opening stream:
                pendingStreams[filename].on('error', function(err) {
                    while (streamResolutionQueue[filename] &&
                           streamResolutionQueue[filename].length > 0) {
                        resolvereject = streamQueue.shift();
                        resolvereject[1](err);
                    }
                    delete pendingStreams[filename];
                    delete streamResolutionQueue[filename];
                });
            }
        });
    };

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
                stream.closeEventually();
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
        }
    };
}

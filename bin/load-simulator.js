#!/usr/bin/env node

var SERVER_URL = "https://localhost:7777" // which server to punish? no trailing slash
var USER_RANGE = [0, 300]; // How many users to create?  The server will handle
                           // twice as many sockets, since each socket connects to
                           // both the event and a session.
var DISABLE_BLUR = false;  // Whether to disable sending blur/focus messages.
var SESSION_RANGE = [0, 30]; // Range of session ID's to use. There ought to
                             // be at least 1 session ID for every 10 users.
var EVENT_ID = 10; // Should be the event loaded with `bin/prepare-load-simulator-data.js`
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // Allow self-signed certs

// If you get the error EMFILE (too many open files), try fixing it with:
//  ulimit -n 2048

//---------------------------------------------------

var logger = require("../lib/logging.js").getLogger(),
    models = require("../lib/server-models.js"),
    conf = require("../conf.json"),
    _ = require("underscore"),
    events = require("events"),
    sock_client = require("sockjs-client-ws");

var EVENT_ROOM_ID = "event/" + EVENT_ID;
models.USER_KEY_SALT = conf.UNHANGOUT_SESSION_SECRET;

/*
 * Object holding a socket and its authorization/join state.
 */
function AuthSock(options) {
    this.state = "disconnected";
    this.userId = options.userId;
    this.sockKey = models.generateSockKey(this.userId);
    this.sock = sock_client.create(SERVER_URL + "/sock");
    this.init();
}
AuthSock.prototype = _.extend({
    init: function() {
        _.bindAll(this, "onerror", "write");
        this.sock.on("connection", _.bind(function() {
            this.write("auth", {key: this.sockKey, id: this.userId});
        }, this));
        this.sock.on("data", _.bind(function(message) {
            var msg = JSON.parse(message);
            switch (msg.type) {
                case 'join-err':
                    if (this.state == "joining") {
                        this.room = null;
                        this.state = "authorized";
                    } else {
                        this.onerror(msg);
                    }
                    break;
                case 'auth-ack':
                    this.state = "authorized";
                    break;
                case "join-ack":
                    this.state = "joined";
                default:
                    if (msg.type.indexOf("-err") != -1) {
                        this.onerror(msg);
                    }
                    break;
            }
            this.emit("data", msg);
        }, this));
        this.sock.on("error", this.onerror);
    },
    onerror: function(err) {
        logger.error(this.userId + " error", err);

    },
    write: function(type, args) {
        this.sock.write(JSON.stringify({type: type, args: args}));
    }
}, events.EventEmitter.prototype);

/*
 * Class representing a random user.  It periodically sends chat messages,
 * joins sessions, and connects and disconnects, and focuses/unfocuses.
 */
function Rando(options) {
    this.event = options.event;
    this.userId = options.userId;
    // Initialize with a random timeout, to mix up the clock ticks.
    setTimeout(_.bind(function() {
        this.init();
    }, this), Math.random() * 1000);
};
Rando.prototype = {
    init: function() {
        _.bindAll(this, "ontick");
        this.eventSock = new AuthSock({userId: this.userId});
        this.sessionSock = new AuthSock({userId: this.userId});
        setInterval(this.ontick, 1000);
    },
    ontick: function() {
        // Event actions
        switch (this.eventSock.state) {
            case "disconnected":
            case "joining":
                break;
            case "authorized":
                // If we're authorized, but haven't started joining, join the
                // event with a 70% probability.
                if (Math.random() > 0.7) {
                    logger.debug(this.userId + " joining");
                    this.eventSock.state = "joining";
                    this.eventSock.write("join", {id: EVENT_ROOM_ID});
                }
                break;
            case "joined":
                if (Math.random() > 0.99) {
                    logger.debug(this.userId + " chatting");
                    this.eventSock.write("chat", {
                        roomId: EVENT_ROOM_ID,
                        text: this.chatMessages[
                            Math.floor(Math.random() * this.chatMessages.length)
                        ]
                    });
                } else if (Math.random() > 0.995) {
                    this.eventSock.write("leave", {
                        id: EVENT_ROOM_ID,
                    });
                    this.eventSock.state = "authorized";
                } else if (Math.random() > 0.9) {
                    if (!DISABLE_BLUR) { 
                        if (this.eventSock.focused) {
                            this.eventSock.write("blur", {roomId: EVENT_ROOM_ID});
                            this.eventSock.focused = false;
                        } else {
                            this.eventSock.write("focus", {roomId: EVENT_ROOM_ID});
                            this.eventSock.focused = true;
                        }
                    }
                }
                break;
        };
        // Session actions
        switch (this.sessionSock.state) {
            case "disconnected":
            case "joining":
                break;
            case "authorized":
                if (Math.random() > 0.9) {
                    var sessionId = SESSION_RANGE[0] + Math.floor(
                        (SESSION_RANGE[1] - SESSION_RANGE[0]) * Math.random()
                    );
                    var roomId = "session/loadSession" + sessionId;
                    this.sessionSock.write("join", {id: roomId});
                    this.sessionSock.state = "joining";
                    this.sessionSock.room = roomId;
                }
                break;
            case "joined":
                if (Math.random() > 0.9) {
                    this.sessionSock.write("leave", {id: this.sessionSock.room});
                    this.sessionSock.state = "authorized";
                    this.sessionSock.room = null;
                }
                break;
        };
    },
    write: function(type, args) {
        this.sock.write(JSON.stringify({type: type, args: args}));
    },
    chatMessages: [
        "From fairest creatures we desire increase,",
        "That thereby beauty's rose might never die,",
        "But as the riper should by time decease,",
        "His tender heir might bear his memory;",
        "But thou, contracted to thine own bright eyes,",
        "Feed'st thy light's flame with self-substantial fuel,",
        "Making a famine where abundance lies,",
        "Thyself thy foe, to thy sweet self too cruel.",
        "Thou, that art now the world's fresh ornament",
        "And only herald to the gaudy spring,",
        "Within thine own bud buriest thy content",
        "And, tender churl, mak'st waste in niggarding.",
        "    Pity the world, or else this glutton be,",
        "    To eat the world's due, by the grave and thee."
    ]
};

function main() {
    for (var i = USER_RANGE[0]; i < USER_RANGE[1]; i++) {
        new Rando({userId: "loadUser" + i});
    }
    logger.warn(
        "Random users loading page: " + SERVER_URL + "/" + EVENT_ROOM_ID
    );
}

if (require.main === module) {
    main();
}

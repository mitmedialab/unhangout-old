#!/usr/bin/env node
//
// Fire up the server, and create a large number of socket connections to
// simulate a lot of traffic in ``event/1`` and its sessions.
//
// NOTE: always runs with USE_SSL=false and mockAuth=true, as required by the
// mock users' sockets.
//

var logger = require("../lib/logging.js").getLogger(),
    _ = require("underscore"),
    events = require("events"),
    config = require("../conf.json"),
    createUsers = require("../lib/passport-mock.js").createUsers,
    sock_client = require("sockjs-client-ws"),
    unhangoutServer = require("../lib/unhangout-server.js");

/*
 * Object holding a socket and its authorization/join state.
 */
function AuthSock(options) {
    this.state = "disconnected";
    this.server = options.server;
    this.sockKey = options.sockKey;
    this.user = this.server.db.users.findWhere({"sock-key": this.sockKey});
    this.sock = sock_client.create(this.server.options.baseUrl + "/sock");
    this.init();
}
AuthSock.prototype = _.extend({
    init: function() {
        _.bindAll(this, "onerror", "write");
        this.sock.on("connection", _.bind(function() {
            this.write("auth", {key: this.sockKey, id: this.user.id});
        }, this));
        this.sock.on("data", _.bind(function(message) {
            var msg = JSON.parse(message);
            if (msg.type.indexOf("-err") != -1) {
                this.onerror(msg);
            } else if (msg.type == "auth-ack") {
                this.state = "authorized";
            } else if (msg.type == "join-ack") {
                this.state = "joined";
            }
            this.emit("data", msg);
        }, this));
        this.sock.on("error", this.onerror);
    },
    onerror: function(err) {
        logger.error(this.sockKey + " error", err);

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
    this.server = options.server;
    this.event = options.event;
    this.sockKey = options.sockKey;
    // Initialize with a random timeout, to mix up the clock ticks.
    setTimeout(_.bind(function() {
        this.init();
    }, this), Math.random() * 1000);
};
Rando.prototype = {
    init: function() {
        _.bindAll(this, "ontick");
        this.eventSock = new AuthSock({server: this.server, sockKey: this.sockKey});
        this.sessionSock = new AuthSock({server: this.server, sockKey: this.sockKey});
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
                // event with a 50% probability.
                if (Math.random() > 0.5) {
                    logger.debug(this.sockKey + " joining");
                    this.eventSock.state = "joining";
                    this.eventSock.write("join", {id: this.event.getRoomId()});
                }
                break;
            case "joined":
                if (Math.random() > 0.99) {
                    logger.debug(this.sockKey + " chatting");
                    this.eventSock.write("chat", {
                        roomId: this.event.getRoomId(),
                        text: this.chatMessages[
                            Math.floor(Math.random() * this.chatMessages.length)
                        ]
                    });
                } else if (Math.random() > 0.99) {
                    this.eventSock.write("leave", {
                        id: this.event.getRoomId(),
                    });
                    this.eventSock.state = "authorized";
                } else if (Math.random() > 0.9) {
                    if (this.eventSock.focused) {
                        this.eventSock.write("blur", {roomId: this.event.getRoomId()});
                        this.eventSock.focused = false;
                    } else {
                        this.eventSock.write("focus", {roomId: this.event.getRoomId()});
                        this.eventSock.focused = true;
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
                if (this.event.get("sessionsOpen") && Math.random() > 0.9) {
                    var sessions = this.event.get("sessions");
                    var session = sessions.at(Math.floor(sessions.length * Math.random()));
                    if (session.getNumConnectedParticipants() < 10) {
                        this.sessionSock.write("join", {id: session.getRoomId()});
                        this.sessionSock.state = "joining";
                        this.sessionSock.room = session.getRoomId();
                    }
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

function init(callback) {
    var server = new unhangoutServer.UnhangoutServer();
    server.on("inited", function() {
        server.start();
    });
    server.on("started", function() {
        createUsers(server.db.users);
        callback(server);
    });
    var options = _.extend({}, config, {mockAuth: true, UNHANGOUT_USE_SSL: false});
    _.each(options, function(value, key) {
        if (key.indexOf('UNHANGOUT_') != -1) {
            options[key.slice(10)] = value;
        }
    });
    server.init(options);
    return server;
}
function main() {
    init(function(server) {
        var event = server.db.events.at(0)
        for (var i = 0; i < 100; i++) {
            new Rando({
                server: server,
                sockKey: "loader" + i,
                event: event
            });
        }
        logger.warn("Random users loading page: " + server.options.baseUrl + "/event/" + event.id);
    });
}

if (require.main === module) {
    main();
}

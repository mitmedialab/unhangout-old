var RoomManager = require("./room-manager").RoomManager,
    _ = require("underscore"),
    events = require("events"),
    models = require("./server-models"),
    sockjs_lib = require("sockjs"),
    VideoSync = require("./video-sync");
    logger = require("./logging").getLogger();


function UnhangoutSocketManager(httpServer, db, options) {
    this.httpServer = httpServer;
    this.db = db;
    this.options = options;
    this.videoSyncs = [];
    _.bindAll(this, "init", "clearVideoSync", "shutdown", "getEvent",
                    "getSession", "ensureSocketInSession");

}
_.extend(UnhangoutSocketManager.prototype, events.EventEmitter.prototype, {
    init: function(sockjs) {
        var sockjs = sockjs_lib.createServer({
            log: function(severity, message) {
                logger.log("debug", severity + ": " + message);
            },
            disconnect_delay: this.options.disconnect_delay
        });
        sockjs.installHandlers(this.httpServer, {prefix: '/sock'});
        this.sockjs = sockjs;
        var mgr = new RoomManager(sockjs, this.db.users);
        this.mgr = mgr;
        // Default authentication (permissive) for "event/" namespace.
        mgr.channelAuth.event = mgr.channelAuth[""];
        // Default authentication (permissive) for "session/" namespace.
        mgr.channelAuth.session = mgr.channelAuth[""];

        mgr.on("join", _.bind(function(socket, args) {
            var channel = args.roomId.split("/")[0];
            if (channel == "event") {
                var event = this.getEvent(args.roomId);
                logger.info("user:" + socket.user.id + " joining event:" + event.id);

                event.get("recentMessages").each(function(message) {
                    var obj = message.toJSON();
                    mgr.writeData(socket, "chat", obj);
                });
                if (args.userFirst) {
                    mgr.broadcast(args.roomId, "join", {
                        id: event.id, user: socket.user.toJSON(), roomId: args.roomId
                    });
                    // TODO: consider whether we can avoid persisting a list of
                    // users in `event`, rather than just using the list that's
                    // already in RoomManager. When sending initial data to the
                    // client, we'd have to pull it from RoomManager..
                    event.get("connectedUsers").set(mgr.roomToUsers[args.roomId]);
                    event.userConnected(socket.user);
                }
                logger.debug("connected users: " + JSON.stringify(event.get("connectedUsers").pluck("displayName")));
            } else if (channel == "session" && args.userFirst) {
                var session = this.getSession(args.roomId);
                if (!session) {
                    logger.warn("Attempt to join room for unknown session", args.roomId);
                    return;
                }
                logger.info("user:" + socket.user.id + " joining session:" + session.id);
                if (args.roomFirst) {
                    session.set("hangoutConnected", true);
                }
                if (session.addConnectedParticipant(socket.user.toJSON())) {
                    session.save();
                }
            }
        }, this));

        mgr.on("leave", _.bind(function(socket, args) {
            var channel = args.roomId.split("/")[0];
            if (channel == "event" && args.userLast) {
                var event = this.getEvent(args.roomId);
                logger.info("user:" + socket.user.id + " leaving event:" + event.id);
                mgr.broadcast(args.roomId, "leave", {
                    id: event.id, user: socket.user.toJSON(), roomId: args.roomId
                });
                event.get("connectedUsers").remove(socket.user);
                if (args.roomLast) {
                    this.clearVideoSync(event.getRoomId());
                }
            } else if (channel == "session" && args.userLast) {
                var session = this.getSession(args.roomId);
                logger.info("user:" + socket.user.id + " leaving session:" + session.id);
                session.removeConnectedParticipant(socket.user);
                if (args.roomLast) {
                    session.set("hangoutConnected", false);
                    this.clearVideoSync(session.getRoomId());
                }
                session.save();
            }
        }, this));

        //
        // Event rooms
        //
        mgr.on("chat", _.bind(function(socket, args) {
            if (!("text" in args)) {
                return mgr.writeErr(socket, "chat", "missing text in chat message");
            }
            var event = this.getEvent(args.roomId);
            if (event && socket.user && mgr.roomContainsSocket(args.roomId, socket)) {
                var msg = new models.ServerChatMessage({
                    user: socket.user,
                    text: args.text
                });
                event.get("recentMessages").push(msg);
                // TODO: Put roomId in broadcast? Can a socket be in more than one room?
                mgr.broadcast(args.roomId, "chat", msg.toJSON());
                mgr.writeAck(socket, "chat");
            } else {
                mgr.writeErr(socket, "chat", "Unknown room");
            }
        }, this));
        mgr.on("blur", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (event && socket.user && mgr.roomContainsSocket(args.roomId, socket)) {
                mgr.broadcast(args.roomId, "blur", {
                    id: socket.user.id,
                    roomId: args.roomId
                });
            }
        }, this));
        mgr.on("focus", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (event && socket.user && mgr.roomContainsSocket(args.roomId, socket)) {
                mgr.broadcast(args.roomId, "focus", {
                    id: socket.user.id,
                    roomId: args.roomId
                });
            }
        }, this));
        // Admin
        mgr.on("create-session", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (event && socket.user && socket.user.isAdminOf(event)) {
                var newSession = new models.ServerSession({
                    title: args.title,
                    activities: args.activities,
                    description: args.description
                });
                newSession.save();
                newSession.once("change:id", function() {
                    event.addSession(newSession);
                    // TODO: Put roomId in broadcast? Can a socket be in more than one room?
                    mgr.broadcast(args.roomId, "create-session", newSession.toJSON());
                });
                mgr.writeAck(socket, "create-session");
            } else {
                mgr.writeErr(socket, "create-session");
            }
        }, this));
        mgr.on("open-sessions", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (event && socket.user && socket.user.isAdminOf(event)) {
                event.openSessions();
                mgr.broadcast(args.roomId, "open-sessions", {roomId: args.roomId});
                mgr.writeAck(socket, "open-sessions");
            } else {
                mgr.writeErr(socket, "open-sessions")
            }
        }, this));
        mgr.on("close-sessions", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (event && socket.user && socket.user.isAdminOf(event)) {
                event.closeSessions();
                mgr.broadcast(args.roomId, "close-sessions", {roomId: args.roomId});
                mgr.writeAck(socket, "close-sessions");
            } else {
                mgr.writeErr(socket, "close-sessions");
            }
        }, this));
        mgr.on("delete-session", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (event && socket.user && socket.user.isAdminOf(event)) {
                var session = event.get("sessions").get(args.id);
                if (session) {
                    session.destroy();
                    event.removeSession(session);
                    mgr.broadcast(args.roomId, "delete-session", {id: args.id, roomId: args.roomId});
                    return mgr.writeAck(socket, "delete-session");
                }
            }
            mgr.writeErr(socket, "delete-session");
        }, this));
        mgr.on("embed", _.bind(function(socket, args) {
            if (!("ytId" in args)) {
                return mgr.writeErr(socket, "embed", "Missing ytId");
            }
            var event = this.getEvent(args.roomId);
            if (event.get("youtubeEmbed") != args.ytId) {
                this.clearVideoSync(event.getRoomId());
            }
            if (event && socket.user.isAdminOf(event)) {
                event.setEmbed(args.ytId);
                event.save();
                mgr.broadcast(args.roomId, "embed", {ytId: args.ytId, roomId: args.roomId});
                mgr.writeAck(socket, "embed");
            } else {
                return mgr.writeErr(socket, "embed", "Missing event or not admin");
            }
        }, this));
        mgr.on("control-video", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (!event) {
                mgr.writeErr(socket, "control-video", "Event not found");
            } else if (!socket.user) {
                mgr.writeErr(socket, "control-video", "Not authenticated");
            } else if (!socket.user.isAdminOf(event)) {
                mgr.writeErr(socket, "control-video", "Not an admin");
            } else if (!event.hasEmbed()) {
                return mgr.writeErr(socket, "control-video", "Event has no embed.");
            } else {
                var sync = this.videoSyncs[event.getRoomId()];
                if (!sync) {
                    sync = this.videoSyncs[event.getRoomId()] = new VideoSync();
                    sync.on("control-video", function(args) {
                        mgr.broadcast(event.getRoomId(), "control-video", args);
                    });
                }
                sync.control(args);
            }
        }, this));

        //
        // Sessions (inside hangouts)
        //

        mgr.on("session/set-hangout-url", _.bind(function(socket, args) {
            var session = this.ensureSocketInSession(mgr, socket, args.sessionId,
                                                     "session/set-hangout-url");
            if (session) {
                var result = session.setHangoutUrl(args.url);
                if (result) {
                    return mgr.writeAck(socket, "session/set-hangout-url");
                } else {
                    return mgr.writeErr(socket, "session/set-hangout-url", {
                        url: session.get("hangout-url")
                   });
                }
            }
        }, this));
        mgr.on("session/set-connected-participants", _.bind(function(socket, args) {
            var session = this.ensureSocketInSession(mgr, socket, args.sessionId,
                                                     "session/set-connected-participants");
            if (session) {
                session.setConnectedParticipants(args.connectedParticipants);
            }
        }, this));
        mgr.on("session/add-activity", _.bind(function(socket, args) {
            var session = this.ensureSocketInSession(mgr, socket, args.sessionId,
                                                     "session/add-activity");
            if (session) {
                var result = session.addActivity(args.activity);
                if (result) {
                    mgr.broadcast(session.getRoomId(), "session/add-activity",
                                  args, socket);
                    return mgr.writeAck(socket, "session/add-activity");
                } else {
                    mgr.writeErr(socket, "session/add-activity");
                }
            }
        }, this));
        mgr.on("session/remove-activity", _.bind(function(socket, args) {
            var session = this.ensureSocketInSession(mgr, socket, args.sessionId,
                                                     "session/remove-activity");
            if (session) {
                if (args.activity.type == "video") {
                    this.clearVideoSync(session.getRoomId());
                }
                var result = session.removeActivity(args.activity);
                if (result) {
                    mgr.broadcast(session.getRoomId(), "session/remove-activity",
                                  args, socket);
                    return mgr.writeAck(socket, "session/remove-activity");
                } else {
                    mgr.writeErr(socket, "session/add-activity");
                }
            }
        }, this));
        mgr.on("session/set-activity-presence", _.bind(function(socket, args) {
            var session = this.ensureSocketInSession(mgr, socket, args.sessionId,
                                                     "session/set-activity-presence");
            if (session) {
                var result = session.setActivityPresence(socket.user.id, args.activity);
                if (result) {
                    args.userId = socket.user.id;
                    mgr.broadcast(session.getRoomId(), "session/set-activity-presence",
                                  args, socket);
                } else {
                    mgr.writeErr(socket, "session/set-activity-presence");
                }
            }
        }, this));
        mgr.on("session/control-video", _.bind(function(socket, args) {
            var session = this.ensureSocketInSession(mgr, socket, args.sessionId,
                                                     "session/control-video");
            if (!session) {
                return mgr.writeErr(socket, "control-video", "Session not found");
            }
            var activity = _.findWhere(session.get("activities"), {type: "video"});
            if (!activity) {
                return mgr.writeErr(socket, "session/control-video",
                                    "Session has no video to control.");
            } else {
                var sync = this.videoSyncs[session.getRoomId()];
                if (!sync) {
                    sync = this.videoSyncs[session.getRoomId()] = new VideoSync();
                    sync.on("control-video", function(args) {
                        args.activity = activity;
                        mgr.broadcast(session.getRoomId(), "session/control-video", args);
                    });
                }
                sync.control(args);
            }
        }, this));

        //
        // Handle broadcast requests from events.
        //
        this.db.events.on("broadcast", function(event, type, data) {
            mgr.broadcast(event.getRoomId(), type, data);
        });

        this.mgr = mgr;
    },
    clearVideoSync: function(id) {
        if (this.videoSyncs[id]) {
            this.videoSyncs[id].pause();
            delete this.videoSyncs[id];
        }
    },
    shutdown: function(callback) {
        this.mgr.destroy();
        this.sockjs = null;
        callback();
    },
    getEvent: function(roomId) {
        var match = /event\/(\d+)/.exec(roomId)
        if (match) {
            var id = parseInt(match[1]);
            var event = this.db.events.get(id);
            return event;
        }
        return null;
    },
    getSession: function(roomId) {
        var match = /session\/(\d+)/.exec(roomId);
        var sessionId;
        if (match) {
            sessionId = parseInt(match[1]);
        } else {
            sessionId = parseInt(roomId);
        }
        var permalinkSession = this.db.permalinkSessions.get(sessionId);
        if (permalinkSession) {
            return permalinkSession;
        } else {
            return this.db.events.getSessionById(sessionId);
        }
    },
    ensureSocketInSession: function(mgr, socket, sessionId, errType) {
        var session, inSession;
        session = this.getSession(sessionId);
        if (!session) {
            return mgr.writeErr(socket, "session/set-connected-participants", "Unknown sessionId");
        }
        inSession = _.any(mgr.roomToUsers[session.getRoomId()], function(u) {
            return u.id == socket.user.id;
        });
        if (!inSession) {
            return mgr.writeErr(socket, "session/set-connected-participants", "You are not in this session.");
        }
        return session;
    }
});

exports.UnhangoutSocketManager = UnhangoutSocketManager;

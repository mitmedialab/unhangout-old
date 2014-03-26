var RoomManager = require("./room-manager").RoomManager,
    _ = require("underscore"),
    events = require("events"),
    models = require("./server-models"),
    sockjs_lib = require("sockjs"),
    VideoSync = require("./video-sync"),
    chatLogging = require("./chat-logger"),
    logger = require("./logging").getLogger(),
    utils = require("./utils");


function UnhangoutSocketManager(httpServer, db, options) {
    this.httpServer = httpServer;
    this.db = db;
    this.options = options;
    this.videoSyncs = {};
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

        /*
         * Helper methods
         */

        function muteEmbeddedVideoFor(user, event) {
            var roomId = event.getRoomId();
            var userSockets = mgr.userIdToSockets[user.id];
            var roomSockets = mgr.roomToSockets[roomId];
            _.each(_.intersection(userSockets, roomSockets), function(socket) {
                mgr.writeData(socket, "control-video", {"mute": true});
            });
        }

        /*
         * Socket setup
         */

        // Authorization for "event/" namespace
        mgr.channelAuth.event = function(user, room, cb) {
            // Authorize all connections.
            return cb(null, true);
        }
        // Authorization for "session/" namespace
        mgr.channelAuth.session = function(user, room, cb) {
            // Restrict to 10 users.
            if (mgr.roomToUsers[room] && mgr.roomToUsers[room].length >= 10) {
                cb("session is full", false);
            } else {
                cb(null, true);
            }
        };

        /*
         * Routes
         */

        mgr.on("join", _.bind(function(socket, args) {
            var channel = args.roomId.split("/")[0];
            if (channel == "event") {
                var event = this.getEvent(args.roomId);
                event.get("recentMessages").each(function(message) {
                    var obj = message.toJSON();
                    mgr.writeData(socket, "chat", obj);
                });
                event.logAnalytics({action: "join", user: socket.user})
                if (args.userFirst) {
                    mgr.broadcast(args.roomId, "join", {
                        id: event.id, user: socket.user.toClientJSON(), roomId: args.roomId
                    });
                    // TODO: consider whether we can avoid persisting a list of
                    // users in `event`, rather than just using the list that's
                    // already in RoomManager. When sending initial data to the
                    // client, we'd have to pull it from RoomManager..
                    event.get("connectedUsers").set(mgr.roomToUsers[args.roomId]);
                    event.userConnected(socket.user);
                }
            } else if (channel == "session" && args.userFirst) {
                var session = this.getSession(args.roomId);
                if (!session) {
                    mgr.writeErr(socket, "join", "session not found");
                    return;
                }
                if (args.roomFirst) {
                    session.onHangoutStarted();
                }
                // Note that we can't rely entirely on socket joining for the
                // entire list of connected participants in sessions, because
                // some session users might not have loaded the app (e.g. if
                // they joined the hangout via an out-of-band link).  Those
                // participants are managed in
                // `session/set-connected-participants`.
                if (session.addConnectedParticipant(socket.user.toJSON())) {
                    session.save();
                }
                if (session.get("isHoA") && session.event) {
                    // If it's an HoA, and the user is connected to the event,
                    // mute the embedded YouTube video's volume to avoid
                    // feedback.
                    muteEmbeddedVideoFor(socket.user, session.event);
                }
                session.logAnalytics({action: "join", user: socket.user});
            }
        }, this));

        mgr.on("leave", _.bind(function(socket, args) {
            var channel = args.roomId.split("/")[0];
            if (channel == "event" && args.userLast) {
                var event = this.getEvent(args.roomId);
                event.get("connectedUsers").remove(socket.user);
                if (args.roomLast) {
                    this.clearVideoSync(event.getRoomId());
                }
                event.logAnalytics({action: "leave", user: socket.user})
                mgr.broadcast(args.roomId, "leave", {
                    id: event.id, user: socket.user.toClientJSON(), roomId: args.roomId
                });
            } else if (channel == "session" && args.userLast) {
                var session = this.getSession(args.roomId);
                if (!session) {
                    logger.error("Request to leave unknown session " + args.roomId);
                    return;
                }
                var before = session.getNumConnectedParticipants();
                session.removeConnectedParticipant(socket.user);
                if (args.roomLast) {
                    this.clearVideoSync(session.getRoomId());
                    session.stopWithDelay();
                }
                session.save();
                session.logAnalytics({action: "leave", user: socket.user})
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
                if (utils.toobusy() && !socket.user.isAdminOf(event)) {
                    return mgr.writeErr(socket, "chat", "Over capacity");
                }
                var msg = new models.ServerChatMessage({
                    user: socket.user,
                    text: args.text
                });
                event.logChat(msg);
                // TODO: Put roomId in broadcast? Can a socket be in more than one room?
                mgr.broadcast(args.roomId, "chat", msg.toJSON());
                mgr.writeAck(socket, "chat");
            } else {
                mgr.writeErr(socket, "chat", "Unknown room");
            }
        }, this));

        //
        // Admin
        //

        mgr.on("create-session", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (event && socket.user && socket.user.isAdminOf(event)) {
                var newSession = new models.ServerSession({
                    title: args.title,
                    activities: args.activities,
                    description: args.description
                });
                event.addSession(newSession);
                newSession.save({}, {
                    success: function() {
                        // TODO: Put roomId in broadcast? Can a socket be in more than one room?
                        mgr.broadcast(args.roomId, "create-session", newSession.toJSON());
                        mgr.writeAck(socket, "create-session");
                        event.logAnalytics({
                            action: "create-session",
                            user: socket.user,
                            session: newSession,
                            title: args.title,
                            activities: args.activities,
                            description: args.description
                        });
                    },
                    error: function(err) {
                        logger.error("Error creating session", err);
                        mgr.writeErr(socket, "create-session");
                    }
                });
            } else {
                mgr.writeErr(socket, "create-session");
            }
        }, this));

        mgr.on("open-sessions", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (event && socket.user && socket.user.isAdminOf(event)) {
                event.openSessions();
                event.save();
                mgr.broadcast(args.roomId, "open-sessions", {roomId: args.roomId});
                mgr.writeAck(socket, "open-sessions");
                event.logAnalytics({action: "open-sessions", user: socket.user});
            } else {
                mgr.writeErr(socket, "open-sessions")
            }
        }, this));

        mgr.on("close-sessions", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (event && socket.user && socket.user.isAdminOf(event)) {
                event.closeSessions();
                event.save();
                mgr.broadcast(args.roomId, "close-sessions", {roomId: args.roomId});
                mgr.writeAck(socket, "close-sessions");
                event.logAnalytics({action: "close-sessions", user: socket.user});
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
                    mgr.writeAck(socket, "delete-session");
                    event.logAnalytics({action: "delete-session", user: socket.user, session: args.id});
                    return
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
                event.logAnalytics({action: "embed", user: socket.user, ytId: args.ytId});
            } else {
                return mgr.writeErr(socket, "embed", "Missing event or not admin");
            }
        }, this));

        mgr.on("remove-hoa", function(socket, args) {
            // Removes the hangout-on-air session from the event.  Does not
            // alter the current youtube embed for the event, even if that
            // embed points to the public broadcast URL for the removed
            // hangout-on-air session.
            var event = this.getEvent(args.roomId);
            var route = "remove-hoa";
            if (!event) {
                mgr.writeErr(socket, route, "Event not found");
            } else if (!socket.user) {
                mgr.writeErr(socket, route, "Not authenticated");
            } else if (!socket.user.isAdminOf(event)) {
                mgr.writeErr(socket, route, "Not an admin");
            } else {
                var hoa = event.get("hoa");
                var dirty;
                if (hoa) {
                    dirty = true;
                    hoa.destroy();
                }
                if (event.get("hangout-broadcast-id") || event.get("hoa")) {
                    dirty = true;
                    event.save({"hangout-broadcast-id": null, "hoa": null})
                }
                if (dirty) {
                    mgr.broadcast(event.getRoomId(), "set-hoa", null);
                }
            }
        }.bind(this));

        mgr.on("control-video", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (!event) {
                mgr.writeErr(socket, "control-video", "Event not found");
            } else if (!socket.user) {
                mgr.writeErr(socket, "control-video", "Not authenticated");
            } else if (!socket.user.isAdminOf(event)) {
                mgr.writeErr(socket, "control-video", "Not an admin");
            } else if (!event.get("youtubeEmbed")) {
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
                event.logAnalytics({action: "control-video", user: socket.user, args: args});
            }
        }, this));

        mgr.on("broadcast-message-to-sessions", _.bind(function(socket, args) {
            var route = "broadcast-message-to-sessions";
            var event = this.getEvent(args.roomId);
            if (!event) {
                mgr.writeErr(socket, route, "Event not found");
            } else if (!socket.user) {
                mgr.writeErr(socket, route, "Not authenticated");
            } else if (!socket.user.isAdminOf(event)) {
                mgr.writeErr(socket, route, "Not an admin");
            } else if (!args.message) {
                mgr.writeErr(socket, route, "Missing `message` argument");
            } else {
                event.get("sessions").each(function(session) {
                    mgr.broadcast(session.getRoomId(), "session/event-message", {
                        sender: socket.user.get("displayName"),
                        message: args.message
                    });
                });
                mgr.writeAck(socket, route);
            }
        }, this));

        //
        // Sessions (inside hangouts)
        //

        mgr.on("session/set-hangout-url", function(socket, args) {
            var session = this.ensureSocketInSession(mgr, socket, args.sessionId,
                                                     "session/set-hangout-url");
            if (session) {
                var result = session.setHangoutUrl(args.url, socket.user, args.id);
                if (result) {
                    session.save();
                    return mgr.writeAck(socket, "session/set-hangout-url");
                } else {
                    return mgr.writeErr(socket, "session/set-hangout-url", {
                        url: session.get("hangout-url")
                   });
                }
            }
        }.bind(this));

        mgr.on("session/set-hangout-broadcast-id", function(socket, args) {
            var route = "session/set-hangout-broadcast-id";
            var session = this.ensureSocketInSession(mgr, socket, args.sessionId, route);
            var event = session.event;

            if (!session) {
                return mgr.writeErr(socket, route, "Session for socket not found.");
            }
            if (!session.get("isHoA")) {
                return mgr.writeErr(socket, route, "Session not a hangout-on-air.");
            }
            if (!socket.user.isAdminOf(event)) {
                return mgr.writeErr(socket, route, "Not an admin");
            }

            if (session.get("hangout-broadcast-id") != args["hangout-broadcast-id"]) {
                session.save({"hangout-broadcast-id": args["hangout-broadcast-id"]});
            }
            if (event.get("youtubeEmbed") != session.get("hangout-broadcast-id")) {
                // NOTE: this is semi-duplicated from the "embed" route above.
                event.setEmbed(session.get("hangout-broadcast-id"));
                event.save();
                mgr.broadcast(event.getRoomId(), "embed", {
                    ytId: session.get("hangout-broadcast-id"), roomId: event.getRoomId()
                });

                // We broadcast the "embed" route to everyone, but only broadcast
                // the HoA to connected admins.
                _.each(mgr.roomToSockets[event.getRoomId()], function(s) {
                    if (s.user.isAdminOf(event)) {
                        mgr.writeData(s, "set-hoa", session.toClientJSONForUser(s.user));
                    }
                });
            }
            // Mute the user's event embed to avoid feedback.
            muteEmbeddedVideoFor(socket.user, session.event);
            return mgr.writeAck(socket, route);

        }.bind(this));

        mgr.on("session/set-connected-participants", _.bind(function(socket, args) {
            var session = this.ensureSocketInSession(mgr, socket, args.sessionId,
                                                     "session/set-connected-participants");
            if (session) {
                session.setConnectedParticipants(args.connectedParticipants);
                return session.save();
            }
        }, this));

        mgr.on("session/set-activities", _.bind(function(socket, args) {
            var session = this.ensureSocketInSession(mgr, socket, args.sessionId,
                                                     "session/set-activities");
            if (session) {
                this.clearVideoSync(session.getRoomId());
                session.set("activities", args.activities, {validate: true});
                if (!session.validationError) {
                    mgr.broadcast(session.getRoomId(), "session/set-activities",
                                  args, socket);
                    mgr.writeAck(socket, "session/set-activities");
                    session.logAnalytics({
                        action: "set-activities",
                        activities: args.activities,
                        user: socket.user
                    });
                    return session.save();
                }
            }
            return mgr.writeErr(socket, "session/set-activities");
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
                session.logAnalytics({action: "control-video", user: socket.user, args: args});
            }
        }, this));

        //
        // Handle broadcast requests from events.
        //
        this.db.events.on("broadcast", function(event, type, data) {
            mgr.broadcast(event.getRoomId(), type, data);
        });
        this.db.events.on("throttled-broadcast", function(event, type, data) {
            mgr.throttledBroadcast(event.getRoomId(), type, data);
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
        var match = /event\/(.+)/.exec(roomId)
        if (match) {
            var id = match[1];
            var event = this.db.events.get(id);
            return event;
        }
        return null;
    },
    getSession: function(roomId) {
        var match = /session\/(.+)/.exec(roomId);
        var sessionId;
        if (match) {
            sessionId = match[1];
        } else {
            sessionId = roomId;
        }
        return (
            this.db.permalinkSessions.get(sessionId) ||
            this.db.events.getSessionById(sessionId)
        );
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

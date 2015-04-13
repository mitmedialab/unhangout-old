var RoomManager = require("./room-manager").RoomManager,
    _ = require("underscore"),
    events = require("events"),
    models = require("./server-models"),
    sockjs_lib = require("sockjs"),
    VideoSync = require("./video-sync"),
    chatLogging = require("./chat-logger"),
    logger = require("./logging").getLogger(),
    validate = require("../public/js/validate"),
    match = require("../public/js/match"),
    utils = require("./utils");

function UnhangoutSocketManager(httpServer, db, options) {
    this.httpServer = httpServer;
    this.db = db;
    this.options = options;
    this.videoSyncs = {};
    _.bindAll(this, "init", "clearVideoSync", "shutdown", "getEvent",
                    "getSession", "ensureSocketInSession", "changeNetworkList");

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
            // Send video sync state, if any
            var sync = this.videoSyncs[args.roomId];
            // Handle channel joining
            if (channel == "event") {
                var event = this.getEvent(args.roomId);
                if (!event) {
                    mgr.writeErr(socket, "join", "event not found");
                    return;
                }
                if (args.userFirst) {
                    event.logAnalytics({action: "join", user: socket.user})
                    event.get("connectedUsers").set(mgr.roomToUsers[args.roomId]);
                }
                if (sync) {
                    mgr.writeData(socket, "control-video", sync.getState());
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
                var added = session.addConnectedParticipant(socket.user.toJSON())
                if (added) {
                    session.save();
                }
                session.logAnalytics({action: "join", user: socket.user});
                if (sync) {
                    mgr.writeData(socket, "session/control-video", sync.getState());
                }
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

                var isAdmin = socket.user.isAdminOf(event);

                var msg = new models.ServerChatMessage({
                    user: socket.user,
                    text: args.text,
                    postAsAdmin: isAdmin && args.postAsAdmin
                });

                event.logChat(msg);

                var matches = match.atMessages(args.text);
                var selfName = match.normalize(socket.user.get("displayName"));

                var users = event.get("connectedUsers");
                var user;

                _.each(matches, function(arr) {

                    var atname = match.normalize(arr[1]);
                    
                    if (selfName.indexOf(atname) == -1) {
                        user = users.find(function(user) {
                            return match.normalize(user.get("displayName")).indexOf(atname) !== -1;
                        });
                    } 

                });

                if (user) {
                    socket.user.changeNetworkList(event.id, user, false);
                }

                mgr.writeAck(socket, "chat");

            } else {
                mgr.writeErr(socket, "chat", "Unknown room");
            }
        }, this));

        mgr.on("change-networklist", _.bind(function(socket, args) {

            var event = this.getEvent(args.roomId);

            if (event && socket.user && mgr.roomContainsSocket(args.roomId, socket)) {

                socket.user.changeNetworkList(event.id, args.atNameUser, true);
                mgr.writeAck(socket, "change-networklist");

            } else {
                mgr.writeErr(socket, "change-networklist");
            }

        }, this));

        //
        // Admin
        //
        mgr.on("edit-whiteboard", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);

              // We save the whiteboard if the user was an admin and the event still exists
            if (event && socket.user && socket.user.isAdminOf(event)) {
                event.save({whiteboard: {message: args.newMessage}});
                mgr.writeAck(socket, "edit-whiteboard");
            } else {
                mgr.writeErr(socket, "edit-whiteboard");
            }
        }, this));

        mgr.on("edit-whiteboard", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);

              // We save the whiteboard if the user was an admin and the event still exists
            if (event && socket.user && socket.user.isAdminOf(event)) {
                event.save({whiteboard: {message: args.newMessage}});
                mgr.writeAck(socket, "edit-whiteboard");
            } else {
                mgr.writeErr(socket, "edit-whiteboard");
            }
        }, this));

        mgr.on("store-contact", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            var user = socket.user; 

            if(event && user) {
                if (validate.preferredContact(args.preferredContact)) {
                  user.set("preferredContact", args.preferredContact);
                  user.save();
                  mgr.writeAck(socket, "store-contact");
                } else {
                  mgr.writeErr(socket, "store-contact");
                }
            } else {
                mgr.writeAck(socket, "store-contact");
            }

        }, this));

        mgr.on("create-session", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (event && socket.user) {
                var joinCap = parseInt(args.joinCap ||
                                       models.ServerSession.prototype.MAX_ATTENDEES);
                if (isNaN(joinCap) || joinCap < 2 || joinCap > 10) {
                    return mgr.writeErr(socket, "Invalid joinCap value");
                }

                var newSession = new models.ServerSession({
                    title: args.title,
                    proposedBy: socket.user.toClientJSON(),
                    activities: args.activities,
                    joinCap: joinCap,
                    description: args.description,
                    approved: args.approved,
                }, {
                    collection: event.get("sessions")
                });

                newSession.save({}, {
                    success: function() {
                        event.get("sessions").add(newSession);
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

        mgr.on("edit-session", _.bind(function(socket, args) {

            var event = this.getEvent(args.roomId);

            if(event && socket.user) {
                var session = event.get("sessions").get(args.id);

                if(session) {                

                    if(socket.user.isAdminOf(event) || 
                        (!event.get("adminProposedSessions") && 
                            session.get("proposedBy") && 
                        session.get("proposedBy").id === socket.user.id)) {

                        session.save({title: args.title});
                        mgr.writeAck(socket, "edit-session");
                        event.logAnalytics({action: "edit-session", user:socket.user, session: args.id});
                        return;
                    }
                }
            }

            mgr.writeErr(socket, "edit-session");

        }, this));  

        mgr.on("delete-session", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (event && socket.user) {
                var session = event.get("sessions").get(args.id);
                
                if (session) {

                    if(socket.user.isAdminOf(event) ||  
                        (!event.get("adminProposedSessions") && 
                            session.get("proposedBy") && 
                        session.get("proposedBy").id === socket.user.id)) {

                        session.destroy();
                        event.get("sessions").remove(session);
                        mgr.writeAck(socket, "delete-session");
                        event.logAnalytics({action: "delete-session", user: socket.user, session: args.id});
                        return;

                    }
                }
            }

            mgr.writeErr(socket, "delete-session");
        }, this));

        mgr.on("vote-session", _.bind(function(socket, args) {

            var event = this.getEvent(args.roomId);

            if (event && socket.user) {

                var session = event.get("sessions").get(args.id);
                
                if (session) {
                    prevVotes = session.get("votedBy");

                    if (prevVotes.indexOf(socket.user) > -1) { 
                            return; 
                    } else {
                        prevVotes.push(socket.user);
                        session.save({votes: args.vote, votedBy: prevVotes});
                        mgr.writeAck(socket, "vote-session");
                        event.logAnalytics({action: "vote-session", user: socket.user, session: args.id});
                        return;
                    }
                }
            }

            mgr.writeErr(socket, "vote-session");
        }, this));

        mgr.on("approve-session", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (event && socket.user && socket.user.isAdminOf(event)) {
                var session = event.get("sessions").get(args.id);
                if (session) {
                    session.save({approved: args.approve});
                    mgr.writeAck(socket, "approve-session");
                    event.logAnalytics({action: "approve-session", user: socket.user});
                    return;
                }
            }
            mgr.writeErr(socket, "approve-session");
        }, this));

        mgr.on("open-sessions", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (event && socket.user && socket.user.isAdminOf(event)) {
                event.save({sessionsOpen: true});
                mgr.writeAck(socket, "open-sessions");
                event.logAnalytics({action: "open-sessions", user: socket.user});
            } else {
                mgr.writeErr(socket, "open-sessions")
            }
        }, this));

        mgr.on("close-sessions", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (event && socket.user && socket.user.isAdminOf(event)) {
                event.save({sessionsOpen: false});
                mgr.writeAck(socket, "close-sessions");
                event.logAnalytics({action: "close-sessions", user: socket.user});
            } else {
                mgr.writeErr(socket, "close-sessions");
            }
        }, this));

        mgr.on("admin-proposed", _.bind(function(socket, args) {
            var event = this.getEvent(args.roomId);

            if (event && socket.user && socket.user.isAdminOf(event)) {
                event.save({adminProposedSessions: args.isAdminSessionsOnly});
                mgr.writeAck(socket, "admin-proposed");
                event.logAnalytics({action: "admin-proposed", user: socket.user});
            } else {
                mgr.writeErr(socket, "admin-proposed");
            }
        }, this));

        mgr.on("embed", function(socket, args) {
            if (!("ytId" in args)) {
                return mgr.writeErr(socket, "embed", "Missing ytId");
            }
            var event = this.getEvent(args.roomId);
            if (event && socket.user.isAdminOf(event)) {
                if (event.get("youtubeEmbed") != args.ytId) {
                    this.clearVideoSync(event.getRoomId());
                }
                event.set("youtubeEmbed", args.ytId);
                event.save();
                mgr.writeAck(socket, "embed");
                event.logAnalytics({action: "embed", user: socket.user, ytId: args.ytId});
            } else {
                return mgr.writeErr(socket, "embed", "Missing event or not admin");
            }
        }.bind(this));

        mgr.on("enqueue", function(socket, args) {
            if (!("ytId" in args)) {
                return mgr.writeErr(socket, "enqueue", "Missing ytId");
            }
            var event = this.getEvent(args.roomId);
            if (event && socket.user.isAdminOf(event)) {
                var prev = event.get("previousVideoEmbeds") || [];
                var val = {youtubeId: args.ytId};
                if (!_.findWhere(prev, val)) {
                    prev = _.clone(prev);
                    prev.unshift(val);
                    event.save({previousVideoEmbeds: prev});
                }
            } else {
                return mgr.writeErr(socket, "enqueue", "Missing event or not admin");
            }
        }.bind(this));

        mgr.on("clear-previous-videos", function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (event && socket.user.isAdminOf(event)) {
                event.save({"previousVideoEmbeds": []});
            } else {
                return mgr.writeErr(socket, "clear-previous-videos",
                                    "Missing event or not an admin");
            }
        }.bind(this));

        mgr.on("remove-one-previous-video", function(socket, args) {
            var event = this.getEvent(args.roomId);
            if (event && socket.user.isAdminOf(event) && args.ytId) {
                var trimmed = _.reject(event.get("previousVideoEmbeds"), function(prev) {
                    return prev.youtubeId === args.ytId;
                });
                event.save({"previousVideoEmbeds": trimmed});
            } else {
                return mgr.writeErr(socket, "remove-one-previous-video",
                                    "Missing event or not an admin");
            }
        }.bind(this));

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
                if (hoa) {
                    hoa.destroy();
                    event.save({"hoa": null});
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
            // Hangouts on air, setting the broadcast ID for their youtube feed.
            var route = "session/set-hangout-broadcast-id";
            var hoa = this.ensureSocketInSession(mgr, socket, args.sessionId, route);
            var event = hoa.event;
            if (!hoa) {
                return mgr.writeErr(socket, route, "hoa for socket not found.");
            }
            if (!hoa.get("isHoA")) {
                return mgr.writeErr(socket, route, "hoa not a hangout-on-air.");
            }
            if (!socket.user.isAdminOf(event)) {
                return mgr.writeErr(socket, route, "Not an admin");
            }

            if (hoa.get("hangout-broadcast-id") != args["hangout-broadcast-id"]) {
                hoa.save({"hangout-broadcast-id": args["hangout-broadcast-id"]});
            }
            return mgr.writeAck(socket, route);

        }.bind(this));

        mgr.on("session/set-connected-participants", function(socket, args) {
            var route = "session/set-connected-participants";
            var session = this.ensureSocketInSession(mgr, socket, args.sessionId, route);
            if (session) {
                if (session.get("hangout-url") === args["hangout-url"]) {
                    session.setConnectedParticipants(args.connectedParticipants);
                    mgr.writeAck(socket, route);
                    return session.save();
                } else {
                    mgr.writeErr(socket, route, "Not in correct hangout");
                }
            } else {
                mgr.writeErr(socket, route, "Not found");
            }
        }.bind(this));

        mgr.on("session/set-activities", _.bind(function(socket, args) {
            var session = this.ensureSocketInSession(mgr, socket, args.sessionId,
                                                     "session/set-activities");
            if (session) {
                this.clearVideoSync(session.getRoomId());
                session.set("activities", args.activities, {validate: true});
                if (!session.validationError) {
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

        /*
         * Broadcasts to maintain synchronization of state
         */

        this.db.events.on("connectedUsers:add", function(event, user) {
            mgr.sync(event.getRoomId(), "state", {
                path: ["event", "connectedUsers"],
                op: "insert",
                value: user.toClientJSON()
            });
        });
        this.db.events.on("connectedUsers:remove", function(event, user) {
            mgr.sync(event.getRoomId(), "state", {
                path: ["event", "connectedUsers"],
                op: "delete",
                findWhere: {id: user.id}
            });
        });

        this.db.events.on("connectedUsers:change:networkList", function(event, user, networkList) {            
            mgr.sync(event.getRoomId(), "state", {
                path: ["event", "connectedUsers", user.id, "networkList"],
                op: "set",
                value: networkList
            });

        });

        this.db.events.on("recentMessages:add", function(event, msg, recentMessages) {
            mgr.sync(event.getRoomId(), "state", {
                path: ["messages"],
                op: "insert",
                type: "ChatMessage",
                value: msg.toClientJSON()
            });
        });
        this.db.events.on("sessions:add", function(event, session, sessions) {
            mgr.sync(event.getRoomId(), "state", {
                path: ["event", "sessions"],
                op: "insert",
                type: "Session",
                value: session.toJSON()
            });

        });
        this.db.events.on("sessions:remove", function(event, session, sessions) {
            mgr.sync(event.getRoomId(), "state", {
                path: ["event", "sessions"],
                op: "delete",
                findWhere: {id: session.id}
            });
        });
        this.db.events.on("change:sessionsOpen", function(event, isOpen) {
            mgr.sync(event.getRoomId(), "state", {
                path: ["event", "sessionsOpen"],
                op: "set",
                value: isOpen
            });
        });

        this.db.events.on("change:adminProposedSessions", function(event, isAdminSessionsOnly) {
            mgr.sync(event.getRoomId(), "state", {
                path: ["event", "adminProposedSessions"],
                op: "set",
                value: isAdminSessionsOnly
            });
        });

        this.db.events.on("change:youtubeEmbed", function(event, ytId) {
            mgr.sync(event.getRoomId(), "state", {
                path: ["event", "youtubeEmbed"],
                op: "set",
                value: ytId
            });
        });
        this.db.events.on("sessions:change:connectedParticipants", function(event, session, cop) {
            var key = ["event", event.getRoomId(), "sessions",
                       session.id, "connectedParticipants", "set"].join(":");
            mgr.throttledSync(key, event.getRoomId(), "state", {
                path: ["event", "sessions", session.id, "connectedParticipants"],
                op: "set",
                value: cop 
            });
        });
        this.db.events.on("sessions:change:joiningParticipants", function(event, session, jop) {
            var key = ["event", event.getRoomId(), "sessions",
                       session.id, "joiningParticipants", "set"].join(":");
            mgr.throttledSync(key, event.getRoomId(), "state", {
                path: ["event", "sessions", session.id, "joiningParticipants"],
                op: "set",
                value: jop 
            });
        });

        this.db.events.on("sessions:change:votes", function(event, session, vs) {
            var key = ["event", event.getRoomId(), "sessions",
                       session.id, "votes", "set"].join(":");
            mgr.throttledSync(key, event.getRoomId(), "state", {
                path: ["event", "sessions", session.id, "votes"],
                op: "set",
                value: vs 
            });
        });

        this.db.events.on("sessions:change:title", function(event, session, title) {
            var key = ["event", event.getRoomId(), "sessions",
                       session.id, "title", "set"].join(":");

            mgr.throttledSync(key, event.getRoomId(), "state", {
                path: ["event", "sessions", session.id, "title"],
                op: "set",
                value: title
            });
        });

        this.db.events.on("sessions:change:approved", function(event, session, ap) {
            var key = ["event", event.getRoomId(), "sessions",
                       session.id, "approved", "set"].join(":");
            mgr.throttledSync(key, event.getRoomId(), "state", {
                path: ["event", "sessions", session.id, "approved"],
                op: "set",
                value: ap 
            });
        });
        this.db.events.on("change:open", function(event, open) {
            mgr.sync(event.getRoomId(), "state", {
                path: ["event", "open"],
                op: "set",
                value: open
            });
        });
        this.db.events.on("change:previousVideoEmbeds", function(event, prev) {
            mgr.sync(event.getRoomId(), "state", {
                path: ["event", "previousVideoEmbeds"],
                op: "set",
                value: prev
            }, function filter(sock) {
                return sock.user.isAdminOf(event);
            });
        });
        this.db.events.on("change:whiteboard", function(event, message){
            mgr.sync(event.getRoomId(), "state", {
                path: ["event", "whiteboard"],
                op: "set",
                value: message
            });
        });

        //
        // Hangout-on-air events
        //

        this.db.events.on("change:hoa", function(event, hoa) {
            mgr.sync(event.getRoomId(), "state", {
                path: ["event", "hoa"],
                op: "set",
                type: "Session",
                value: hoa === null ? null : hoa.toClientJSON()
            }, function filter(sock) {
                return sock.user.isAdminOf(event);
            });
        });
        // Wire up set operations for each key hoa param, filtered for admins.
        ["connectedParticipants",
         "joiningParticipants",
         "hangout-url",
         "hangout-broadcast-id",
         "hangout-pending"].forEach(function(route) {
            this.db.events.on("hoa:change:" + route, function(event, hoa, val) {
                mgr.sync(event.getRoomId(), "state", {
                    path: ["event", "hoa", route], op: "set", value: val
                }, function filter(sock) {
                    return sock.user.isAdminOf(event);
                });
            });
        }.bind(this));

        //
        // Broadcasts for sessions
        //
        this.db.events.on("sessions:change:activities", function(event, session, activities) {
            mgr.sync(session.getRoomId(), "session/set-activities", activities);
        });
    },

    changeNetworkList: function(roomId, user, socket, toggle) {

        prevNetworkList = _.clone(socket.user.get("networkList"));

        prevOtherUsers = []; 

        if(prevNetworkList[roomId]) {

            prevOtherUsers = prevNetworkList[roomId]; 

            var index = prevOtherUsers.indexOf(user.id); 

            if (index > -1) {

                if(toggle) {

                    prevOtherUsers.splice(index, 1);

                    prevNetworkList[roomId] = prevOtherUsers;
                    socket.user.save({networkList: prevNetworkList});
                    logger.debug("REMOVE FROM NETWORK");
                }

                return; 
            } 
        }

        prevOtherUsers.push(user.id);

        prevNetworkList[roomId] = prevOtherUsers;
        socket.user.save({networkList: prevNetworkList});
        logger.debug("ADD TO NETWORK");
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

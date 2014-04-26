var events = require('events'),
    _      = require('underscore'),
    uuid   = require('node-uuid'),
    logger = require('./logging').getLogger();
/*
* RoomManager handles connection, disconnection, and authentication of sockets,
* joining and leaving of ``rooms`` (collections of sockets which may receive
* broadcasts).
*
* MESSAGES:
*
* Socket messages should each be JSON of the form:
* { type: "string", args: {object} }
*
* On connection, sockets authenticate by sending an 'auth' message with a 'key'
* and 'id' that are set by the client:
* {type: "auth", args: {key: "auth key", id: <user id>} }
*
* Sockets ask to join a room by sending a join request with the room ID, and
* optionally, the timestamp of their last known-good data:
* { type: "join", args: {id: "<room id>", timestamp: [seconds, nanoseconds]} }
*
* Sockets ask to leave a room by sending a leave request with the room ID:
* { type: "leave", args: {id: "<room id>"} }
*
* For all other message types, the room manager emits an event with the name as
* the message type, and does no further processing.
*
* EVENTS:
*
* All events trigger with an "args" object.
*
* "auth": fired when a user successfully authenticates. args:
* {
*   socket: the socket
*   first: is this the first authed socket from this user?
* }
*
* "join": fired when a socket successfully joins a room. args:
* {
*   socket: the socket
*   roomId: the room that was joined
*   userFirst: is this the first socket for this user in this room?
*   roomFirst: is this the first socket in this room?
* }
*
* "leave": fired when a socket leaves a room, either through disconnection or a
* "leave" message. args:
* {
*   socket: the socket
*   roomId: the room that was left
*   userLast: was this the last socket for this user in this room?
*   roomLast: was this the last socket in this room?
* }
*
* "disconnect": fired when a socket disconnects.
* {
*   socket: the socket that disconnected.
*   authenticated: was the socket authenticated?
*   last: was this the last socket belonging to this user?
* }
*
* All other socket message types are fired with <type>, and their incoming args.
*
* ROOM AUTHORIZATION:
*
* Room authorization uses the concept of "channels", with authorization
* per-channel. A channel is identified by the part of a room name before the
* first "/" delimiter -- e.g. the room named "superusers/chat" has the channel
* "admins".  The room ID is the whole name including the channel.
*
* To require authorization for rooms in a particular channel, set an
* authorization function to RoomManager.channelAuth.  For example:
*
*   var rm = RoomManager(socketServer, users);
*   rm.channelAuth.superusers = function(socket, room, callback) {
*       var authorized = user.isSuperuser();
*       callback(null, authorized);
*   }
*
* The callback expects arguments (err, authorized).
*
* The default channel, empty-string, requires no authorization, and is called
* whenver there is no "/" delimeter in the join request.
*/

exports.RoomManager = function (socketServer, users) {
    // The length of time, in milliseconds, to keep operations in the operation
    // log with which to catch up clients who missed some messages (e.g. while
    // initially connecting).
    this.OP_LOG_AGE = 60000;

    this.sockServer = socketServer;
    this.users = users;
    // A map of channel names to authorization functions.  The function should
    // take the signature:  function(socket, room, callback), and should check
    // whether ``user`` is authorized to join the room.  After checking, the
    // function should call ``callback`` with (err, authorized) to indicate
    // whether the user is authorized or an error has occurred.
    this.channelAuth =  {
        // Default channel authorization is permissive.
        "": function(user, room, cb) { cb(null, true); }
    };
    // Map of room ID's to an array of sockets that are in that room.
    this.roomToSockets = {};
    // map of socket IDs to an array of rooms that socket is in.
    this.socketIdToRooms = {};
    // map of socket ID to the user that owns that socket
    this.socketIdToUser = {};
    // map of user ID to a list of sockets that user has (e.g. tabs, windows).
    this.userIdToSockets = {};
    // map of room ID's to an array of users
    this.roomToUsers = {};
    // A map of socket ID's to socket bindings so we can remove listeners.
    this.socketBindings = {};
    // A map of room ID's to lists of operations.
    this.opLog = {};
    this.init();
};

_.extend(exports.RoomManager.prototype, events.EventEmitter.prototype, {
    init: function() {
        _.bindAll(this, "destroy", "handleConnection", "unbind", "route",
                  "handleAuth", "handleJoinRequest", "joinWithoutAuth",
                  "handleLeave", "handleDisconnect", "writeUser", "writeAck",
                  "writeErr", "writeData", "getUsers", "broadcast");
        this.sockServer.on("connection", this.handleConnection);
        // For throttled broadcasts, a mapping of broadcast 'key' (combination
        // of roomId, socket id, and type) to setTimeout ID.
        this._throttledSyncTimeouts = {};
        // Mapping of broadcast 'key' to the actual function that will be executed
        // when the timeout finishes.  This function might be replaced before
        // execution.
        this._throttledSyncFunctions = {};

    },
    destroy: function() {
        this.sockServer.removeListener("connection", this.handleConnection);
        for (var socketId in this.socketBindings) {
            this.unbind(socketId);
            logger.debug("RoomManager unbinding ID " + socketId);
        }
    },
    handleConnection: function(socket, data) {
        logger.debug('RoomManager connection' + socket);
        socket.user = null;
        socket.id = uuid.v4();

        // Set up an object to store socket bindings for later removal.
        var bindings = {socket: socket, events: {}};
        bindings.events.close = _.bind(function() { this.handleDisconnect(socket); }, this);
        bindings.events.data = _.bind(function(message) {
            //logger.debug("RoomManager message from " + socket.id + ":", message);
            var data;
            try {
                data = JSON.parse(message);
            } catch (e) {
                return this.writeErr(socket, "", "Invalid JSON: " + message);
            }
            if (!data.type) {
                this.writeErr(socket, "", "Received message without 'type' key: " + message);
            } else {
                this.route(socket, data);
            }
        }, this);
        logger.debug("RoomManager binding ID" + socket.id);
        socket.once('close', bindings.events.close);
        socket.on('data', bindings.events.data);
        this.socketBindings[socket.id] = bindings;
    },
    unbind: function (socketId) {
        var binding = this.socketBindings[socketId];
        if (binding) {
            _.each(binding.events, function(fn, event) {
                binding.socket.removeListener(event, fn);
            });
            delete this.socketBindings[socketId];
        }
    },
    route: function (socket, data) {
        if (data.type === "auth") {
            if (data.args && "id" in data.args && "key" in data.args) {
                this.handleAuth(socket, data.args);
            } else {
                this.writeErr(socket, "auth", "Missing 'id' or 'key'");
            }
        } else if (data.type === "join") {
            if (data.args && "id" in data.args) {
                this.handleJoinRequest(socket, String(data.args.id), data.args.timestamp);
            } else {
                this.writeErr(socket, "join", "Missing 'id' args");
            }
        } else if (data.type === "leave") {
            if (data.args && "id" in data.args) {
                this.handleLeave(socket, data.args.id);
            } else {
                this.writeErr(socket, "leave", "Missing 'id' args");
            }
        } else {
            if (socket.user) {
                this.emit(data.type, socket, data.args);
            } else {
                this.writeErr(socket, data.type, "Not authenticated yet.");
            }
        }
    },
    handleAuth: function (socket, args) {
        var user = this.users.get(args.id);
        // this is the bulk of authentication here; we're checking that the key
        // presented in the message is the same as by the user in .getSockKey()
        // - which is called during page load by the templating engine. That
        // sets the key in the server-side user object, and then we check that
        // it matches here.
        if (_.isUndefined(user) || !user.validateSockKey(args.key)) {
            return this.writeErr(socket, "auth", "Invalid key or user id " + args.id);
        }

        socket.user = user;
        this.socketIdToUser[socket.id] = user;
        var sockets = this.userIdToSockets[user.id] || [];
        if (!_.find(sockets, function(s) { return s.id == socket.id })) {
            sockets.push(socket);
        }
        this.userIdToSockets[user.id] = sockets;
        this.emit("auth", {
            socket: socket,
            first: this.userIdToSockets[user.id].length == 1
        });
        this.writeAck(socket, "auth");
    },
    handleJoinRequest: function (socket, roomId, timestamp) {
        var channel;
        if (roomId.indexOf("/") != -1) {
            channel = roomId.split("/")[0];
        } else {
            channel = "";
        }
        if (_.isUndefined(this.channelAuth[channel])) {
            return this.writeErr(socket, "join", "Unknown channel: " + roomId);
        }
        this.channelAuth[channel](socket, roomId, _.bind(function(err, authorized) {
            if (err) {
                return this.writeErr(socket, "join", err);
            }
            if (authorized) {
                this.joinWithoutAuth(socket, roomId, timestamp);
            } else {
                this.writeErr(socket, "join", "Permission to join " + roomId + " denied.");
            }
        }, this));
    },
    joinWithoutAuth: function (socket, roomId, timestamp) {
        // Validate timestamp.  Timestamp is optional, but must be valid if
        // provided.
        if (timestamp) {
            var valid = (
                _.isArray(timestamp) &&
                timestamp.length === 2 &&
                timestamp.every(_.isFinite)
            );
            if (!valid) {
                return this.writeErr(socket, "join", "Invalid timestamp");
            }
            var hrnow = process.hrtime(); // [seconds, nanoseconds]
            if (timestamp[0] <= hrnow[0] - this.OP_LOG_AGE) {
                return this.writeErr(socket, "stale-state");
            }
        }

        // the room's sockets
        var sockets = this.roomToSockets[roomId] || [];
        // the socket's rooms
        var rooms = this.socketIdToRooms[socket.id] || [];
        // the room's users
        var users = this.roomToUsers[roomId] || [];

        // Is this the first socket belonging to this user which is in this
        // room?  This is useful for identifyng if this is a repeat entrance to
        // the room, for updating user lists and such.
        var userFirst;
        if (_.any(users, function(u) { return u.id == socket.user.id })) {
            userFirst = false;
        } else {
            userFirst = true;
            users.push(socket.user);
        }
        if (!_.contains(rooms, roomId)) {
            rooms.push(roomId);
        }
        if (!_.any(sockets, function(s) { return s.id == socket.id })) {
            sockets.push(socket);
        }

        // If these were new lists, we need to assign them.
        this.roomToSockets[roomId] = sockets;
        this.socketIdToRooms[socket.id] = rooms;
        this.roomToUsers[roomId] = users;

        // Send ack and trigger.
        this.writeAck(socket, "join");
        this.emit("join", socket, {
            roomId: roomId,
            userFirst: userFirst,
            roomFirst: sockets.length == 1
        });

        // Send any broadcasts the connecting socket missed since page load.
        if (_.isArray(timestamp) && timestamp.length === 2 && timestamp.every(_.isFinite)) {
            this.catchUp(socket, roomId, timestamp);
        }
    },
    handleLeave: function(socket, roomId) {
        var sockets = this.roomToSockets[roomId] || null;
        var rooms = this.socketIdToRooms[socket.id] || null;
        var users = this.roomToUsers[roomId] || null;
        // Is this the last socket owned by this session that was in this room?
        // This is useful for identifying when a user has completely left a
        // room, to update room user lists and such.
        var userLast;

        if (sockets) {
            sockets = _.reject(sockets, function(s) { return s.id == socket.id });
            if (sockets.length == 0) {
                delete this.roomToSockets[roomId];
            } else {
                this.roomToSockets[roomId] = sockets;
            }
        }
        if (rooms) {
            rooms = _.without(rooms, roomId);
            if (rooms.length == 0) {
                delete this.socketIdToRooms[socket.id];
            } else {
                this.socketIdToRooms[socket.id] = rooms;
            }
        }
        // if there are no sockets, or none of the sockets belong to our user,
        // we are the last user.
        userLast = !sockets || !_.any(sockets, function(s) {
            return s.user.id == socket.user.id
        });
        if (users && userLast) {
            users = _.reject(users, function(u) { return u.id == socket.user.id; });
            if (users.length == 0) {
                delete this.roomToUsers[roomId];
            } else {
                this.roomToUsers[roomId] = users;
            }
        }
        this.writeAck(socket, "leave", {id: roomId});
        this.emit("leave", socket, {
            roomId: roomId,
            userLast: userLast,
            roomLast: !sockets || sockets.length == 0
        });
    },
    handleDisconnect: function(socket) {
        // Last refers to whether this is the last socket belonging to this
        // user. If the user was not authenticated, last is null.
        var last = null;
        if (this.socketIdToUser[socket.id]) {
            delete this.socketIdToUser[socket.id];
        }
        var authenticated = !!socket.user;
        if (authenticated) {
            var sockets = this.userIdToSockets[socket.user.id] || [];
            sockets = _.reject(sockets, function(s){ return s.id == socket.id });
            if (sockets.length == 0) {
                delete this.userIdToSockets[socket.user.id];
                last = true;
            } else {
                this.userIdToSockets[socket.user.id] = sockets;
                last = false;
            }
        }
        _.each(this.socketIdToRooms[socket.id] || [], _.bind(function(room) {
            this.handleLeave(socket, room);
        }, this));
        this.emit("disconnect", socket, {
            // Was the user authenticated?
            authenticated: authenticated,
            // Is this the last socket belonging to this user to leave?
            last: last
        });
    },
    writeUser: function(user, type, args) {
        // Call "writeData" for each socket belonging to this user.
        var sockets = this.userIdToSockets[user.id] || [];
        _.each(sockets, _.bind(function(s) { this.writeData(s, type, args); }, this));
    },
    writeAck: function(socket, type, args) {
        this.writeData(socket, type + "-ack", args);
    },
    writeErr: function(socket, type, args) {
        logger.warn("RoomManager socket error", {type: type, args: args});
        logger.analytics("socket-error", {
            module: "room-manager",
            type: type,
            args: args,
            socket: socket
        });
        this.writeData(socket, type + "-err", args);
    },
    writeData: function(socket, type, args, timestamp) {
        timestamp = timestamp || process.hrtime();
        var message = JSON.stringify({type: type, args: args, timestamp: timestamp});
        socket.write(message);
    },
    getUsers: function(room) {
        return this.roomToUsers[room] || [];
    },
    roomContainsSocket: function(room, socket) {
        return _.any(this.roomToSockets[room], function(s){
            return s.id == socket.id;
        });
    },
    // broadcast: Call "writeData" for each socket that has joined the given
    // room, optionally filtering by sockets which pass the test `filter`.
    broadcast: function(roomId, type, args, filter, timestamp) {
        // Use `process.hrtime()` so we can distinguish between messages sent
        // in the same millisecond (e.g. two back-to-back messages from the
        // same update).  hrtime is a tuple [seconds, nanoseconds].
        // http://nodejs.org/api/process.html#process_process_hrtime
        // Even subsequent operations in the same loop should get different
        // nanosecond values, so this is safe as a monotonic index of log
        // entries.
        var timestamp = timestamp || process.hrtime();
        var sockets = this.roomToSockets[roomId];
        logger.debug("BROADCAST", timestamp, type, args);
        _.each(sockets, function(s) {
            if (filter && !filter(s)) { return; }
            this.writeData(s, type, args, timestamp);
        }.bind(this));
    },
    // sync: Similar to broadcast, but store a history of messages (an
    // "operation log"), so that clients who missed some messages can be caught
    // up.
    sync: function(roomId, type, args, filter) {
        var log = this.opLog[roomId];
        var hrnow = process.hrtime(); // [seconds, nanoseconds]
        if (!log) { log = this.opLog[roomId] = []; }

        // prune old logs.
        // logs look like: [
        //   [[seconds, nanoseconds], <type>, <args>, <filter()>],
        //   ...
        // ]
        var cutoff = hrnow[0] - this.OP_LOG_AGE / 1000;
        while (log.length > 0 && log[0][0][0] < cutoff) {
            log.shift();
        }

        // append this operation to the log.
        log.push([hrnow, type, args, filter]);
        // and broadcast immediately.
        this.broadcast(roomId, type, args, filter, hrnow);
    },

    catchUp: function(socket, roomId, lastTimestamp) {
        var log = this.opLog[roomId] || [];
 
        // Binary search to find the starting index from the
        // [seconds, nanoseconds] timestamps.  We aren't using _.sortedIndex
        // here, because it wants the iterator to return a single value -- and
        // converting two large integers in JS to a single JS value (whether an
        // IEEE float, which all numbers are, or a string, or whatever) is a
        // trickier than just doing our own binary search.

        var low = 0, high = log.length;
        while (low < high) {
            var mid = (low + high) >>> 1;
            // compare seconds first, nanoseconds second
            if (log[mid][0][0] < lastTimestamp[0] || (
                log[mid][0][0] === lastTimestamp[0] && log[mid][0][1] < lastTimestamp[1]
            )) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        // We have the starting point.
        for (var i = low; i < log.length; i++) {
            // apply filtering function, if any
            if (log[i][3] && !log[i][3](socket)) {
                continue;
            }
            // catch socket up:    type       args       timestamp tuple
            this.writeData(socket, log[i][1], log[i][2], log[i][0]);
        }
    },

    throttledSync: function(roomId, type, args, filter) {
        // Broadcast to sockets with a delay, in order to improve performance
        // in large rooms.  A new broadcast of the same roomId and type
        // replaces an older one that has not fired yet.

        // NOTE: this should only be used with broadcasts where a later
        // broadcast of the same type to the same room completely supercedes a
        // previous broadcast, as it functions by throwing away earlier
        // messages when a new one of the same type comes to the room.
        var sockets = this.roomToSockets[roomId];
        var key = [roomId, type].join(":");

        // Replace the function for this key with the current broadcast, so
        // when it fires, the latest data will be sent.
        this._throttledSyncFunctions[key] = function() {
            this.sync(roomId, type, args, filter);
        }.bind(this);

        // If we haven't yet, schedule a broadcast.  This broadcast will
        // always fire after the timeout with the latest data we have.
        if (!this._throttledSyncTimeouts[key]) {
            this._throttledSyncTimeouts[key] = setTimeout(function() {
                if (this._throttledSyncFunctions[key]) {
                    this._throttledSyncFunctions[key]();
                }
                delete this._throttledSyncTimeouts[key];
                delete this._throttledSyncFunctions[key];
            }.bind(this), 100);
        }
    }
});

var sockjs_lib = require("sockjs"),
    events = require("events"),
    _ = require("underscore")
    models = require("./server-models"),
    logger = require("./logging").getLogger();

// helper methods to do repetetive protocol-related work of extracting
// sessions from messages and dealing with errors.
function getSessionFromMessage(message, user, event, type) {
    var session = event.get("sessions").get(message.args.id);
    
    if(_.isNull(session) || _.isUndefined(session)) {
        user.writeErr(type, "session is not in event list");
        return new Error("session is not in event list");
    } else {
        return session;
    }
}

// like above, but for events.
function getEvent(message, user, type) {
    var event = user.get("curEvent");
    if(_.isNull(event) || _.isUndefined(event)) {
        user.writeErr(type, "user has no event");
        return new Error("user has no event");
    } else {
        return event;
    }
}

// I really want these to be class methods on a socket, but I'll be damned if I can
// figure out how to do it.
function writeErr(conn, msgType, errorMessage) {
    if(!_.isUndefined(errorMessage) && !_.isNull(errorMessage)) {
        conn.write(JSON.stringify({type:msgType+"-err", args:{message:errorMessage}}));
    } else {
        conn.write(JSON.stringify({type:msgType+"-err"}));
    }
}

function writeAck(conn, msgType) {
    conn.write(JSON.stringify({type:msgType+"-ack"}));
}

/*
    Main export: manager for sockets.
*/
function UnhangoutSocketManager(httpServer, db, options) {
    this.httpServer = httpServer;
    this.db = db;
    this.options = options;
    _.bindAll(this, "init", "shutdown");
    this.unauthenticatedSockets = {};
}
_.extend(UnhangoutSocketManager.prototype, events.EventEmitter, {
    init: function() {
		// create a sockjs server, and shim their default built in logging behavior
		// into our standard logger.
		this.sockjs = sockjs_lib.createServer({
			"log": function(severity, message) {
				logger.log("debug", severity + ": " + message);
			},
			"disconnect_delay": this.options.disconnect_delay
		});
		
		// when we get a new sockjs connection, register it and set up 
		this.sockjs.on('connection', _.bind(function(conn) {			
		    logger.info('connection' + conn);
					
			// flag the connection as unauthenticated until we get an authentication message.
			conn.authenticated = false;
			
			// this can be helpful for debugging purposes, to have separate distinct
			// connection ids.
			conn.id = Math.floor(Math.random()*10000000);
			
			// put this connection in the unauthenticated list
			this.unauthenticatedSockets[conn.id] = conn;
		
			// when the connection closes, make sure the user object 
			// hears about it.
		    conn.once('close', _.bind(function() {
				if(conn.authenticated) {
					logger.info("closing id: " + conn.id);
					conn.user.disconnect();
				} else {
					// if they never authenticated, just clean out the unauthenticated
					// sockets list.
					delete this.unauthenticatedSockets[conn.id];
				}
		    }, this));
			
			// this is where the primary protocol specification lives. whenever
			// we get a message FROM a client, this method is called. Messages
			// arive as raw strings.

		    conn.on('data', _.bind(function(string) {

				// TODO wrap this in error handling

				// reject messages that don't JSON parse
				var message;
				try {
					message = JSON.parse(string);
				} catch (e) {
					logger.warn("Error parsing message from client: " + string);
					return;
				}

				// reject messages that don't have a "type" field
				if(!("type" in message)) {
					logger.warn("Received message without 'type' key: " + string);
					return;
				}
				var user;

				// switch on the message type
				//
				// Each message type has some similar components.
				// First, we check for relevant arguments that we need to have
				// to execute the command. Then we assemble the relevant objects
				// for the operation, ie the user object and session object if
				// a user is trying to sign up for a session. Finally,
				// we execute the action on the object, eg call "attend" on the
				// session with the specified user object. 
				//
				// We try whenever possible to return descriptive error messages
				// if something about the arguments is wrong. 
				switch(message.type) {
					case "auth":
						// expecting: "id" and "key"
						if("id" in message.args && "key" in message.args) {
							
							user = this.db.users.get(message.args.id);
							
							if(_.isUndefined(user)) {
								logger.warn("User presented unrecognized id: " + message.args.id);
								writeErr(conn, "auth");
								return;
							}
							
							// this is the bulk of the command here; we're checking
							// that the key presented in the message is the same as
							// by the user in .getSockKey() - which is called during
							// page load by the templating engine. That sets the key
							// in the server-side user object, and then we check that
							// it matches here. 

							if(user.validateSockKey(message.args.key)) {
								logger.info("AUTHENTICATED sock " + conn.id + " to user " + user.id);
								conn.authenticated = true;
								// TODO send a message to the client acknowledging.
								
								// since the socket is now authenticated, remove it
								// from the unauthenticated pool.
								delete this.unauthenticatedSockets[conn.id];
								
								user.setSock(conn);
								conn.user = user;
								
								writeAck(conn, "auth");
							} else {
								logger.warn("Invalid key presented for user " + user.id);
								writeErr(conn, "auth");
							}
							
						} else {
							logger.warn("Missing 'id' or 'key' in AUTH message payload.");
							writeErr(conn, "auth");
							return;
						}
						break;
					case "join":
						// mark which event page they're on
						user = conn.user;
						
						// check arguments
						if(!("id" in message.args)) {
							user.writeErr("join");
							return;
						}
						
						// confirm the event to be joined exists
						// the getEvent wrapper abstracts this process,
						// including sending error messages to the client
						// if the event doesn't exist (as specified in
						// msg.args)
						var event = this.db.events.get(message.args.id);
						if(_.isUndefined(event)) {
							user.write("join-err", "Invalid event id.");
							return;
						}

						// if(event instanceof Error) return;
												
						// join it!
						// this will generate the relevant broadcast messages
						// to tell other users that someone has joined. 
						event.userConnected(user);
						user.writeAck("join");
						break;
					case "create-session":
						user = conn.user;

						// enforce admin-ness of the user who is trying to 
						// create a session. 
						if(!user.isAdmin()) {
							logger.warn("User " + user.id + " tried to create-session, but is not an admin.");
							user.writeErr("create-session");
							return;
						}
						
						var event = getEvent(message, user, "create-session");
						if(event instanceof Error) return;

						if("title" in message.args && "description" in message.args) {
							// make the new session!
							var newSession = new models.ServerSession({"title":message.args.title, "description":message.args.description});
							newSession.save();

							// once the id has been set in the save process,
							// add the session to the event.
							logger.debug("pre bind");
							newSession.on("change:id", _.once(function() {
								// the broadcast happens in addSession, as does the event save.
								event.addSession(newSession);
							}));

							user.writeAck("create-session");
						} else {
							user.writeErr("create-session", "Missing name or description in arguments.");
						}
						
						break;
					case "chat":
						user = conn.user;
						
						if(!("text" in message.args)) {
							user.writeErr("chat", "missing text in chat message");
							return;
						}
						
						var event = getEvent(message, user, "chat");
						if(event instanceof Error) return;
												
						try {
							event.sendChatFromUser(message.args.text, user)							;
							user.writeAck("chat");
						} catch (e) {
							user.writeErr("chat");
						}
						
						break;

					case "delete":
						user = conn.user;
						if(!user.isAdmin()) {
							logger.warn("User " + user.id + " tried to delete, but is not an admin.");
							user.writeErr("delete");
							return;
						}
						
						var event = getEvent(message, user, "delete");
						if(event instanceof Error) return;
						
						var session = getSessionFromMessage(message, user, event, "delete");
						if(session instanceof Error) return;
						
						session.destroy();
						event.removeSession(session);
						logger.info("Removed session: " + session.id + " from event " + event.id);
						user.writeAck("delete");
						event.save();
						break;

					case "open-sessions":
						user = conn.user;
						if(!user.isAdmin()) {
							logger.warn("User " + user.id + " tried to open sessions, but is not an admin.");
							user.writeErr("open-sessions");
							return;
						}

						var event = getEvent(message, user, "open-sessions");
						if(event instanceof Error) return;

						event.openSessions();

						user.writeAck("open-sessions");
						event.save();
						break;

					case "close-sessions":
						user = conn.user;
						if(!user.isAdmin()) {
							logger.warn("User " + user.id + " tried to open sessions, but is not an admin.");
							user.writeErr("close-sessions");
							return;
						}

						var event = getEvent(message, user, "close-sessions");
						if(event instanceof Error) return;

						event.closeSessions();
						user.writeAck("close-sessions");

						event.save();
						break;

					// sets the current video embed. An empty string is considered
					// no embed. 
					case "embed":
						user = conn.user;
						if(!user.isAdmin()) {
							logger.warn("User " + user.id + " tried to set embed, but is not an admin.");
							user.writeErr("embed");
							return;
						}

						var event = getEvent(message, user, "embed");
						if(event instanceof Error) return;
												
						if("ytId" in message.args) {
							event.setEmbed(message.args.ytId);
							user.writeAck("embed");
							event.save();
						} else {
							user.writeErr("embed");
						}

						break;

					// blur and focus are just mini state change events on
					// the user object. they help users track who has the
					// lobby window as their fore-ground window, and who has
					// switched to some other window (probably a hangout)
					// nothing fancy here, just flipping a bit in the user
					// object.
					case "blur":
						 user = conn.user;

						if(!("id" in message.args)) {
							user.writeErr("blur", "missing id in args");
							return;
						}
						
						var event = getEvent(message, user, "blur");
						if(event instanceof Error) return;
						
						user.setBlurred(true);
						
						break;

					case "focus":
						 user = conn.user;

						if(!("id" in message.args)) {
							user.writeErr("focus", "missing id in args");
							return;
						}
						
						var event = getEvent(message, user, "focus");
						if(event instanceof Error) return;
						
						user.setBlurred(false);

						break;

					default:
						logger.warn("Server does not handle '" + message.type + "' type events.");
						break;
				}

				logger.info("message:" + user.id + ":" + message.type + "  " + JSON.stringify(message.args));

		    }, this));
		}, this));
		
		logger.info("sockjs server created");
		
		// sockjs negotiates its startup process over http. so, we need to
		// tell it where in our routing it should put its endpoints.
		this.sockjs.installHandlers(this.httpServer, {prefix:'/sock'});
		
		logger.info("socket handlers installed");
    },
    shutdown: function(callback) {
        this.sockjs.removeAllListeners();
        // this little bit of cleverness is disconnecting all the unauthenticated sockets
        // in parallel, and then once they all return a "close" event, moving on with
        // the shutdown process. The dance through types here is:
        // 1. go from an Object that is socket.id -> socket to just a list of sockets (_.values)
        //      also, merge in all the sock objects from users
        // 2. convert each of those sockets into a function that disconnects that socket, and calls
        //      the callback function when it's successful
        // 3. put those resulting function references into a list of parallel functions to execute
        async.parallel(_.map(_.union(_.values(this.unauthenticatedSockets), this.db.users.pluck("sock")), function(socket) {
            // if the socket doesn't exist, just callback instantly
            if(_.isNull(socket) || _.isUndefined(socket)) {
                return function(callback) {
                    callback();
                }
            };
            return function(callback) {
                socket.on("close", callback);
                socket.close()
            };
        }), callback);
    }
});

module.exports.UnhangoutSocketManager = UnhangoutSocketManager;

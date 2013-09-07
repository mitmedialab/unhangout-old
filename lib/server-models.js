var client_models = require('../public/js/models.js'),
	_ = require('underscore')._,
    sanitize = require('validator').sanitize,
	crypto = require('crypto');


exports.USER_KEY_SALT = "SET ME EXTERNALLY";

// dummy logger, set externally
exports.logger = function() {};

// reference to the server, set externally. 
exports.server = null;

exports.ServerUser = client_models.User.extend({
	idRoot: "user",
	urlRoot: "user",
	
	default: {
		picture: "",
		createdViaHangout: false			// this field is set in situations where the user doesn't actually log in with us, but
											// instead shows up in a participants message from an instrumented hangout.
	},
	
	// This method generates time invariant key that gets embedded in all pages
	// and can be used on the sockjs channel to authenticate a sock connection
	// as belonging to this user. It is simply the id of the user plus some salt.
	// The user can then present this key plus the userid they wish to authenticate
	// as, and the server can verify that it matches the key it would have identified
	// using that salt.
	getSockKey: function() {
		if(_.isUndefined(this.get("sock-key"))) {
			var shasum = crypto.createHash('sha256');
			shasum.update(this.get("id"));
			shasum.update(exports.USER_KEY_SALT);
			this.set("sock-key", shasum.digest('hex'));
		}
		
		return this.get("sock-key");
	},
	
	validateSockKey: function(key) {
		return key == this.getSockKey();
	},
	
	isConnected: function() {
		return !_.isUndefined(this.get("sock")) && !_.isNull(this.get("sock"));
	},

	toJSON: function() {
		var attrs = _.clone(this.attributes);
		delete attrs["sock-key"];
		delete attrs["sock"];
		delete attrs["curEvent"];
		delete attrs["isBlurred"];
		return attrs;
	},
	
	setEvent: function(event) {
		this.set("curEvent", event);
	},
	
	disconnect: function() {
		exports.logger.info("user:" + this.id + " disconnected.");
		this.set("sock", null);
		this.trigger("disconnect");
	},
	
	write: function(type, args) {
		if(!this.isConnected()) {
			exports.logger.warn("Tried to send a message to a user without a socket: " + this.id);
			return;
		}

		var sock = this.get("sock");
		if(_.isUndefined(args)) {
			args = {};
		}
		
		var fullMessage = JSON.stringify({type:type, args:args});
		sock.write(fullMessage);
	},
	
	writeErr: function(type, message) {
		if(_.isUndefined(message)) {
			this.write(type + "-err");
		} else {
			this.write(type + "-err", {message:message});
		}
	},
	
	writeAck: function(type, args) {
		this.write(type + "-ack", args);
	},
	
	setSock: function(sock) {
		this.set("sock", sock);
		this.trigger("ready");
	},

	setBlurred: function(blurred) {
		client_models.User.prototype.setBlurred.call(this, blurred);
		this.get("curEvent").broadcast(blurred ? "blur" : "focus", {id: this.id});
	}
});

exports.ServerUserList = client_models.UserList.extend({
	model:exports.ServerUser
});

exports.ServerEventList = client_models.EventList.extend({
	model:exports.ServerEvent
});


exports.ServerEvent = client_models.Event.extend({
	urlRoot: "event",
	idRoot: "event",
	
	initialize: function() {
		this.set("sessions", new exports.ServerSessionList([], {event:this}));
		this.set("connectedUsers", new exports.ServerUserList());
	},

	userConnected: function(user) {
		this.get("connectedUsers").add(user);
		user.setEvent(this);

		this.broadcast("join", {id:this.id, user:user.toJSON()});
		
		exports.logger.info("user:" + user.id + " joining event:" + this.id);
		exports.logger.debug("connected users: " + JSON.stringify(this.get("connectedUsers").pluck("displayName")));
		
		user.on("disconnect", _.bind(function() {
			exports.logger.info("user:" + user.id + " leaving event:" + this.id);
			this.get("connectedUsers").remove(user);
			
			// exports.logger.debug("connected users: " + JSON.stringify(this.get("connectedUsers")));
			
			this.broadcast("leave", {id:this.id, user:user.toJSON()});
			
			user.off("disconnect");
		}, this));
	},
	
	broadcast: function(type, args) {
		this.get("connectedUsers").each(function(user) {
			user.write(type, args);
		});
	},
	
	setEmbed: function(ytId) {
		if(ytId != this.get("youtubeEmbed")) {
			client_models.Event.prototype.setEmbed.call(this, ytId);
			// now broadcast it.
			this.broadcast("embed", {ytId:ytId});
		}
	},

	addSession: function(session, suppressSave) {
		client_models.Event.prototype.addSession.call(this, session);

		this.broadcast("create-session", session.toJSON());

		if(!suppressSave) {
			this.save();
		}
	}
});

exports.ServerSession = client_models.Session.extend({

	heartbeatInterval: null,
	nullHeartbeatCount: 0,

	defaults: function() {
		return _.extend(client_models.Session.prototype.defaults(), {
			"session-key":null,
			"hangout-url": null,
			"hangout-pending": null,
			"last-heartbeat":null
		});
	},

	initialize: function(args) {
		client_models.Session.prototype.initialize.call(this, args)

		this.on("change:hangoutConnected", function() {
			exports.logger.debug("in change:hangoutConnected " + this.previousAttributes()["hangoutConnected"] + "->" + this.get("hangoutConnected"));
			if(this.previousAttributes()["hangoutConnected"]==false && this.get("hangoutConnected")==true) {
				this.trigger("hangout-started");
			} else if(this.previousAttributes()["hangoutConnected"]==true && this.get("hangoutConnected")==false) {
				this.trigger("hangout-stopped");
			}
		});

		this.on("hangout-started", _.bind(function() {
				exports.logger.info("hangout startup for session " + this.id + ":" + this.get("title"));

				// send a message to clients that the hangout is connected.
				if(this.collection.event) {
					this.collection.event.broadcast("session-hangout-connected", {id:this.id});
				}
				
				// then the hangout is starting now!
				// by default, the hangouts should heartbeat every 5000ms. 
				// we'll run at the same period, and check if it's been > 5000ms since 
				// the last hearbeat. we expect this to be out of sync with the heartbeat
				// period, and it will usually be another 2-3 seconds after we miss a 
				// heartbeat before we notice it here. 
				this.heartbeatInterval = setInterval(_.bind(function() {
					if(_.isNull(this.get("last-heartbeat"))) {
						this.nullHeartbeatCount++;
						exports.logger.warn("last-heartbeat was null in a heartbeat check (" + this.nullHeartbeatCount + ")");

						if(this.nullHeartbeatCount>3) {
							exports.logger.warn("3 null heartbeats in a row, shutting down hangout");
							this.set("hangoutConnected", false);
						}
						return;
					}

					this.nullHeartbeatCount = 0;

					exports.logger.debug("time since heartbeat: " + (new Date().getTime() - this.get("last-heartbeat")));
					if(new Date().getTime() - this.get("last-heartbeat") > 8000) {
						exports.logger.info("session:" + this.id + " missed a heartbeat, shutting down");
						this.set("hangoutConnected", false);
					} else {
						exports.logger.debug("session:" + this.id + ":heartbeat-check");
					}
				}, this), 6000);
		}, this));


		this.on("hangout-stopped", _.bind(function() {
			exports.logger.info("hangout shutdown for session " + this.id + ":" + this.get("title"));

			// clear the connected participants list, too, so it's properly initialized for a future connection.
			this.set("connectedParticipantIds", []);

			// we'll bypass the normal setHangoutUrl method here because that one
			// will ignore any attempts to set the url if it has a non-null value.
			// but in this case, we want to set a null value so future attempts to 
			// connect to this hangout result in a new url getting issued.
			this.set("hangout-url", null);

			if(this.collection.event) {
				this.collection.event.broadcast("session-hangout-disconnected", {id:this.id});				
			}

			clearInterval(this.heartbeatInterval);

			this.save();
		}, this));


		// now check to see if the hangout is already connected when we initialize the serversession. This happens
		// in situations where the server crashes while hangouts are running, and when we reload we want to have
		// the heartbeat checking running properly. 
		if(this.get("hangoutConnected")) {
			exports.logger.debug("Triggering hangout-started on load.");

			// this is an annoying hack. it turns out that ServerSession.collection isn't set, because 
			// in the initialization process sessions are created before they're assigned to events.
			// This means that if we try to do a broadcast (the second line of hangout-started event above)
			// it will fail. Instead, we wait until the collection is assigned to do this.
			// (this is triggered manually in Event.addSession, because backbone doesn't seem to fire
			// this event on its own)

			this.on("change:collection", function() {
				this.trigger("hangout-started");
			}, this);
		}
	},

	url: function() {
		return this.collection.url() + "/" + this.id;
	},
	
	addAttendee: function(user) {
		var err = client_models.Session.prototype.addAttendee.call(this, user);

		if(!err) {
			this.collection.event.broadcast("attend", {id:this.id, user:user.toJSON()});
			this.save();
		}

		return err;
	},
	
	removeAttendee: function(user) {
		var err = client_models.Session.prototype.removeAttendee.call(this, user);

		if(!err)  {
			this.collection.event.broadcast("unattend", {id:this.id, user:user.toJSON()});
			this.save();
		}

		return err;
	},
	
	start: function() {
		if(this.get("started")) {
			return new Error("cannot start a session that is already started");
		}

		client_models.Session.prototype.start.call(this);
		
		// generate a sessionkey
		var shasum = crypto.createHash('sha256');
		shasum.update(this.get("id") + "");
		shasum.update(new Date().getTime() + "");
		this.set("session-key", shasum.digest('hex'));
		
		exports.logger.debug("set session key: " + this.get("session-key"));
	
		// if we're part of an event, broadcast to it.	
		if(this.collection.event) {
			this.collection.event.broadcast("start", {id:this.id, key:this.get("session-key")});		
		}
	},

	stop: function() {
		if(!this.get("started")) {
			return new Error("cannot stop a session that has not started");
		}

		if(this.get("stopped")) {
			return new Error("cannot stop a session that has already stopped");
		}

		client_models.Session.prototype.stop.call(this);

		if(this.collection.event) {
			this.collection.event.broadcast("stop", {id:this.id});
		}
	},
	
	startHangoutWithUser: function(user) {
		exports.logger.debug("starting hangout with user: " + JSON.stringify(user));
		if(this.isHangoutPending()) {
			return new Error("Hangout is pending, cannot start it again");
		} else {
			this.set("hangout-pending", {userId:user.id, time:new Date().getTime()});
			return true;
		}
	},
	
	isHangoutPending: function() {
		if(_.isNull(this.get("hangout-pending"))) {
			return false;
		} else {
			return true;
		}
	},
	
	getHangoutUrl: function() {
		return this.get("hangout-url");
	},
	
	setHangoutUrl: function(url) {
		if(_.isNull(this.get("hangout-url"))) {
			exports.logger.debug("setting hangout url: " + url + " and clearing pending. notifying listeners.");
			this.set("hangout-url", url);
			this.set("hangout-pending", null);

			this.trigger("hangout-url", url);
		}
	},

	setConnectedParticipantIds: function(participantIds) {
		client_models.Session.prototype.setConnectedParticipantIds.call(this, participantIds);

		// broadcast this change to all people in the event.
		if(this.collection.event) {
			this.collection.event.broadcast("session-participants", {id:this.id, participantIds:this.get("connectedParticipantIds")});
		}

		exports.logger.debug("hangoutConnected: " + this.get("hangoutConnected"));
	},

	heartbeat: function() {
		this.set("last-heartbeat", new Date().getTime());
	},

	// We don't actually use this yet. We would only care about this when 
	// people don't want to name their new session themselves.
	generateShortCode: function() {
		if(this.get("shortCode")) {
			exports.logger.warn("Trying to generate a short code for a session that already had one.");
			return;
		}

		var shasum = crypto.createHash('sha256');
		shasum.update(this.get("id"));
		shasum.update(new Date().getTime());
		shasum.update(exports.USER_KEY_SALT);

		this.set("shortCode", shasum.digest('hex').slice(0, 6));
	}
});

exports.ServerSessionList = client_models.SessionList.extend({
	model:exports.ServerSession,
	event:null,
	
	initialize: function(models, options) {
		if(options) {
			this.event = options.event;
		}
	},
	
	url: function() {
		if(_.isNull(this.event) || _.isUndefined(this.event)) {
			return "session/permalink";
		} else {
			return this.event.url() + "/sessions";
		}
	}
});

exports.ServerChatMessage = client_models.ChatMessage.extend({

	initialize: function(options) {
		client_models.ChatMessage.prototype.initialize.call(this, options);

		if(this.has("text")) {
			this.set("text", sanitize(this.get("text")).escape());
		}
	}
});


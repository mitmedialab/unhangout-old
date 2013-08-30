var client_models = require('../public/js/models.js'),
	_ = require('underscore')._,
    sanitize = require('validator').sanitize,
	crypto = require('crypto');

// This file contains extensions to the core models defined in 
// public/js/models.js.
// 
// In general, these extensions have to do with networking. On the server,
// we expect most models to broadcast changes to their state to connected
// clients in their event. This is usually abstracted in the model itself
// in response to state changes.
//
// The other category of extensions is pieces of model state that don't
// need to be visible to clients, like server-side socket information,
// hangout urls, and other callback tracking.

exports.USER_KEY_SALT = "SET ME EXTERNALLY";

// dummy logger, set externally
exports.logger = function() {};

// reference to the server, set externally. 
exports.server = null;

exports.ServerUser = client_models.User.extend({
	idRoot: "user",
	urlRoot: "user",
	
	default: {
		picture: ""
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
	
	// given a key that a user has given us, is it the same as the key we
	// expect from them?
	validateSockKey: function(key) {
		return key == this.getSockKey();
	},
	
	isConnected: function() {
		return !_.isUndefined(this.get("sock")) && !_.isNull(this.get("sock"));
	},

	// we override toJSON because we want to knock out some attributes of this
	// object that are transient, ie they should not persist to redis. 
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
	
	// A wrapper for SockJS messaging. This isn't doing anything significant, just
	// being a little helper to format messages the right way with a type and args,
	// and stringifying. Also checks for some undefined edge cases.
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
	
	// same as write, except appends -err to the type when it writes.
	writeErr: function(type, message) {
		if(_.isUndefined(message)) {
			this.write(type + "-err");
		} else {
			this.write(type + "-err", {message:message});
		}
	},
	
	// appends ack
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

		// add the user to the list of users connected to this event
		this.get("connectedUsers").add(user);
		user.setEvent(this);

		// tell everyone that this user has joined
		this.broadcast("join", {id:this.id, user:user.toJSON()});
		
		exports.logger.info("user:" + user.id + " joining event:" + this.id);
		exports.logger.debug("connected users: " + JSON.stringify(this.get("connectedUsers").pluck("displayName")));
		
		// add an on-disconnect listener, so we can clean up after this user when
		// they disconnect.
		user.on("disconnect", _.bind(function() {
			exports.logger.info("user:" + user.id + " leaving event:" + this.id);
			this.get("connectedUsers").remove(user);
			
			this.broadcast("leave", {id:this.id, user:user.toJSON()});
			
			user.off("disconnect");
		}, this));
	},
	
	// send a message to everyone in this event.	
	broadcast: function(type, args) {
		this.get("connectedUsers").each(function(user) {
			user.write(type, args);
		});
	},
	
	// update the embed for this event (wrapped so we broadcast appropriately)
	setEmbed: function(ytId) {
		if(ytId != this.get("youtubeEmbed")) {
			client_models.Event.prototype.setEmbed.call(this, ytId);
			// now broadcast it.
			this.broadcast("embed", {ytId:ytId});
		}
	},

	// add a new session to this event
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

		// these listeners are for responding to messages from connected, currently
		// live hangouts. 

		// this particular event triggers when the server makes a change to this 
		// session's hangoutConnected field. It could be changing it in either direction,
		// so we need to disambiguate between starting and stopping by checking
		// the previous state.
		this.on("change:hangoutConnected", function() {
			exports.logger.debug("in change:hangoutConnected " + this.previousAttributes()["hangoutConnected"] + "->" + this.get("hangoutConnected"));

			if(this.previousAttributes()["hangoutConnected"]==false && this.get("hangoutConnected")==true) {
				this.trigger("hangout-started");
			} else if(this.previousAttributes()["hangoutConnected"]==true && this.get("hangoutConnected")==false) {
				this.trigger("hangout-stopped");
			}
		});

		// this triggers from the above event, when we're sure we've gone from
		// hangout not connected to hangout connected.
		this.on("hangout-started", _.bind(function() {
			exports.logger.info("hangout startup for session " + this.id + ":" + this.get("title"));

			// send a message to clients that the hangout is connected.
			this.collection.event.broadcast("session-hangout-connected", {id:this.id});
			
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

				// check and see if the last heartbeat is within the window for
				// a "live" hangout. if it isn't, shut the hangout down by
				// changing hangoutConnected to false.
				exports.logger.debug("time since heartbeat: " + (new Date().getTime() - this.get("last-heartbeat")));
				if(new Date().getTime() - this.get("last-heartbeat") > 8000) {
					exports.logger.info("session:" + this.id + " missed a heartbeat, shutting down");
					this.set("hangoutConnected", false);
				} else {
					exports.logger.debug("session:" + this.id + ":heartbeat-check");
				}
			}, this), 6000);
		}, this));

		// handle a hangout shutting down
		this.on("hangout-stopped", _.bind(function() {
			exports.logger.info("hangout shutdown for session " + this.id + ":" + this.get("title"));

			// clear the connected participants list, too, so it's properly initialized for a future connection.
			this.set("connectedParticipantIds", []);

			// we'll bypass the normal setHangoutUrl method here because that one
			// will ignore any attempts to set the url if it has a non-null value.
			// but in this case, we want to set a null value so future attempts to 
			// connect to this hangout result in a new url getting issued.
			this.set("hangout-url", null);

			// tell everyone in the event
			this.collection.event.broadcast("session-hangout-disconnected", {id:this.id});

			// stop checking for heartbeats.
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
		
		this.collection.event.broadcast("start", {id:this.id, key:this.get("session-key")});		
	},

	stop: function() {
		if(!this.get("started")) {
			return new Error("cannot stop a session that has not started");
		}

		if(this.get("stopped")) {
			return new Error("cannot stop a session that has already stopped");
		}

		client_models.Session.prototype.stop.call(this);

		this.collection.event.broadcast("stop", {id:this.id});
	},
	
	// this is part of the non-farming-based strategy; we mark the user as
	// trying to start a hangout, and have anyone else who tries to join
	// wait on their hangout to phone home. 
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

			// if we have a valid hangout url set, mark it as not pending anymore.
			this.set("hangout-pending", null);

			// let anyone who was waiting for a hangout url from this session know
			// that we have a valid one now.
			this.trigger("hangout-url", url);
		}
	},

	// in response to a live hangout telling us who is connected right now, 
	// update our internal representation of that list.
	setConnectedParticipantIds: function(participantIds) {
		client_models.Session.prototype.setConnectedParticipantIds.call(this, participantIds);

		// broadcast this change to all people in the event.
		this.collection.event.broadcast("session-participants", {id:this.id, participantIds:this.get("connectedParticipantIds")});

		exports.logger.debug("hangoutConnected: " + this.get("hangoutConnected"));
	},

	heartbeat: function() {
		this.set("last-heartbeat", new Date().getTime());
	}
});

exports.ServerSessionList = client_models.SessionList.extend({
	model:exports.ServerSession,
	event:null,
	
	initialize: function(models, options) {
		this.event = options.event;
	},
	
	url: function() {
		return this.event.url() + "/sessions";
	}
});

exports.ServerChatMessage = client_models.ChatMessage.extend({

	initialize: function(options) {
		client_models.ChatMessage.prototype.initialize.call(this, options);

		// sanitize the text so people can't put HTML or javascript or whatever
		// in their messages and cause trouble.
		if(this.has("text")) {
			this.set("text", sanitize(this.get("text")).escape());
		}
	}
});


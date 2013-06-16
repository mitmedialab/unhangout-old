var client_models = require('../public/js/models.js'),
	_ = require('underscore')._,
	crypto = require('crypto');


exports.USER_KEY_SALT = "SET ME EXTERNALLY";

// dummy logger, set externally
exports.logger = function() {};

exports.ServerUser = client_models.User.extend({
	idRoot: "user",
	urlRoot: "user",
	
	
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
		delete attrs["curEvent"]
		return attrs;
	},
	
	setEvent: function(event) {
		this.set("curEvent", event);
	},
	
	disconnect: function() {
		exports.logger.info("user " + this.id + " disconnected.");
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
		
		user.on("disconnect", _.bind(function() {
			this.get("connectedUsers").remove(user);
			this.broadcast("leave", {id:this.id, user:user.toJSON()});
		}, this));
	},
	
	broadcast: function(type, args) {
		this.get("connectedUsers").each(function(user) {
			user.write(type, args);
		});
	}
});

exports.ServerSession = client_models.Session.extend({
	url: function() {
		return this.collection.url() + "/" + this.id;
	},
	
	addAttendee: function(user) {
		this.get("attendee_ids").push(user.id);
		
		this.collection.event.broadcast("attend", {id:this.id, user:user.toJSON()});
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

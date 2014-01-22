var client_models = require('../public/js/models.js'),
    logger = require('./logging').getLogger(),
	_ = require('underscore')._,
    sanitize = require('validator').sanitize,
	crypto = require('crypto'),
    conf = require("./options");

// How long do we wait for the first participant to join before we consider the
// hangout URL to be a failure?
var HANGOUT_CONNECTION_TIMEOUT = 20000;
// If a participant is creating a non-farmed hangout URL, how long do we give
// them before assuming they've skipped out?
var HANGOUT_CREATION_TIMEOUT = 20000;

// This file contains extensions to the core models defined in 
// public/js/models.js.
// 
// The extensions ar pieces of model state that don't need to be visible to
// clients, like socket keys, hangout urls, and callback tracking.


exports.USER_KEY_SALT = "SET ME EXTERNALLY";
exports.generateSockKey = function(id) {
	// This method generates time invariant key that gets embedded in all pages
	// and can be used on the sockjs channel to authenticate a sock connection
	// as belonging to this user. It is simply the id of the user plus some salt.
	// The user can then present this key plus the userid they wish to authenticate
	// as, and the server can verify that it matches the key it would have identified
	// using that salt.
    var shasum = crypto.createHash('sha256');
    shasum.update(id);
    shasum.update(exports.USER_KEY_SALT);
    return shasum.digest('hex');
};

exports.ServerUser = client_models.User.extend({
	idRoot: "user",
	urlRoot: "user",
    adminCache: {},
	
	defaults: {
		picture: "",
		createdViaHangout: false // this field is set in situations where the user doesn't actually log in with us, but
								 // instead shows up in a participants message from an instrumented hangout.
	},
	
	getSockKey: function() {
		if(_.isUndefined(this.get("sock-key"))) {
            this.set("sock-key", exports.generateSockKey(this.id));
		}
		
		return this.get("sock-key");
	},
	
	// given a key that a user has given us, is it the same as the key we
	// expect from them?
	validateSockKey: function(key) {
		return key == this.getSockKey();
	},

    isAdminOfSomeEvent: function() {
        return _.some(this.adminCache, function(v) { return v; });
    },
	
	// we override toJSON because we want to knock out some attributes of this
	// object that are transient, ie they should not persist to redis. 
	toJSON: function() {
		var attrs = _.clone(this.attributes);
		delete attrs["sock-key"];
		delete attrs["isBlurred"];
		return attrs;
	}
});

exports.ServerUserList = client_models.UserList.extend({
	model:exports.ServerUser,
 
    // This is a handler for passport authentication, to create or update our
    // local user instances when a user logs in.
    registerOrUpdate: function(accessToken, refreshToken, profile, done) {
        var user = this.get(profile.id);
        if (!user) {
            logger.analytics("users", {
                action: "create",
                user: user,
                totalUsers: this.length
            });
            user = new exports.ServerUser();
        } else {
            logger.analytics("users", {action: "login", user: user});
        }
        // Override any existing fields with the google+ profile info, minus
        // the parts we don't need.
        delete profile["_raw"];
        user.set(profile);

        if (!user.get("superuser")) {
            // Check if this user is a member of the hard-coded list of
            // superusers in configuration.  If so, grant them superuser status.
            _.each(_.pluck(user.get("emails"), "value"), function(email) {
                if (conf.UNHANGOUT_SUPERUSER_EMAILS.indexOf(email) > -1) {
                    logger.debug("granting superuser from config");
                    user.set("superuser", true);
                }
            });
        }
        user.save()
        this.add(user);
        done(null, user.toJSON());
    }
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
		this.set("recentMessages", new exports.ServerChatList());

	},

    userConnected: function(user) {
        // add the user to the list of users connected to this event
        this.get("connectedUsers").add(user);
    },

	// add a new session to this event
	addSession: function(session, suppressSave) {
		client_models.Event.prototype.addSession.call(this, session);
		if(!suppressSave) {
			this.save();
		}
	},
	removeSession: function(session, suppressSave) {
		client_models.Event.prototype.removeSession.call(this, session);
		if(!suppressSave) {
			this.save();
		}
	},

	start: function() {
		var err = client_models.Event.prototype.start.call(this);
		if(err) return err;
		this.save();
	},

	stop: function() {
		var err = client_models.Event.prototype.stop.call(this);
		if(err) return err;
		this.save();
	},

	toJSON: function() {
		var attrs = client_models.Event.prototype.toJSON.call(this);
		delete attrs["recentMessages"];
		return attrs;
	},
    logAnalytics: function(opts) {
        logger.analytics("events", _.extend({
            event: this,
            eventStart: this.get('start'),
            eventEnd: this.get('end'),
            connectedUsers: this.get('connectedUsers').length
        }, opts));
    }
});

exports.ServerSession = client_models.Session.extend({

	defaults: function() {
		return _.extend(client_models.Session.prototype.defaults(), {
			"session-key":null,
			"hangout-url": null,
			"hangout-pending": null,
			"creationKey":null,
			"isPermalinkSession":false,
			"total-instances":0, 
			"total-seconds":0, 
			"user-seconds":0,
			"hangout-start-time":null
		});
	},

	initialize: function(args) {
		client_models.Session.prototype.initialize.call(this, args)
        _.bindAll(this, "onHangoutStarted", "onHangoutStopped")

		// make sure not to overwrite the built-in session-key
		// if we've loaded one through the db.
		if(_.isNull(this.get("session-key"))) {
			var shasum = crypto.createHash('sha256');
			shasum.update(this.get("id") + "");
			shasum.update(new Date().getTime() + "");
			this.set("session-key", shasum.digest('hex'));
		}

		// these listeners are for responding to messages from connected, currently
		// live hangouts. 

		// this particular event triggers when the server makes a change to this 
		// session's hangoutConnected field. It could be changing it in either direction,
		// so we need to disambiguate between starting and stopping by checking
		// the previous state.
		this.on("change:hangoutConnected", _.bind(function() {
			if(this.get("hangoutConnected")) {
                this.onHangoutStarted();
			} else {
                this.onHangoutStopped();
			}
		}, this));
        
        // now check to see if the hangout is already connected when we
        // initialize the serversession. This happens in situations where the
        // server crashes while hangouts are running, and the sockets
        // re-connect.
		if(this.get("hangoutConnected")) {
			logger.debug("server-models triggering hangout-started on load.");

            // this is an annoying hack. it turns out that
            // ServerSession.collection isn't set, because in the
            // initialization process sessions are created before they're
            // assigned to events.  This means that if we try to do a broadcast
            // (the second line of hangout-started event above) it will fail.
            // Instead, we wait until the collection is assigned to do this.
            // (this is triggered manually in Event.addSession, because
            // backbone doesn't seem to fire this event on its own)

            // if it's a permalink session, just start immediately. No need to
            // do the collection hack.
			if(this.get("isPermalinkSession")) {
				this.onHangoutStarted();
			} else {
				this.on("change:collection", _.bind(function() {
                    this.onHangoutStarted
				}, this));
			}
		}
    },
    onHangoutStarted: function() {
		// send a message to clients that the hangout is connected.
		if(this.collection && this.collection.event) {
            var event = this.collection.event;
            event.trigger("broadcast", event, "session-hangout-connected", {id:this.id});
		}
		this.set("total-instances", this.get("total-instances")+1);
        this.set("hangout-start-time", new Date().getTime());
        this.logAnalytics({action: "start"});
    },
    onHangoutStopped: function() {
        // clear the connected participants list, too, so it's properly
        // initialized for a future connection.
		this.set("connectedParticipants", []);
		this.set("hangout-url", null);
		this.set("hangout-start-time", null);
		if(this.collection.event) {
            var event = this.collection.event;
            event.trigger("broadcast", event, "session-hangout-disconnected",
                          {id:this.id});
		}

		this.save();
        this.logAnalytics({action: "stop"});
	},

	url: function() {
		return this.collection.url() + "/" + this.id;
	},
		
	// this is part of the non-farming-based strategy; we mark the user as
	// trying to start a hangout, and have anyone else who tries to join
	// wait on their hangout to phone home. 
	startHangoutWithUser: function(user) {
		if(this.isHangoutPending()) {
            this.logAnalytics({action: "unfarmed start denied while pending", user: user});
			return new Error("Hangout is pending, cannot start it again");
		} else {
			// if a user is provided, add in the user id.
			// in permalink mode, we won't get the userid on start, because
			// we're not forcing them to log into google before redirecting them.
			var obj = {time:new Date().getTime()};
			if(user) {
				obj["userId"] = user.id;
			} 
			this.set("hangout-pending", obj);
            this.logAnalytics({action: "unfarmed start", user: user});
			return true;
		}
	},
	
	isHangoutPending: function() {
		if(_.isNull(this.get("hangout-pending"))) {
			return false;
		} else {
            // check and see how long it's been since we marked it pending. If
            // it's been more than HANGOUT_CREATION_TIMEOUT seconds, give up
            // and let this person be the new designee. If someone DOES
            // actually complete the process after this, then we're sort of in
            // trouble because they'll be floating, and their app will attempt
            // to set the url.

			// obj has (optionally) "userId" and definitely has "time"
			var obj = this.get("hangout-pending");

			if((new Date().getTime() - obj.time) > HANGOUT_CREATION_TIMEOUT) {
                this.logAnalytics({action: "unfarmed start timeout"});
				this.set("hangout-pending", null);
				return false;
			}
			return true;
		}
	},
	
	getHangoutUrl: function() {
		return this.get("hangout-url");
	},
	
	setHangoutUrl: function(url) {
		if(_.isNull(this.get("hangout-url"))) {
			this.set("hangout-url", url);

			// if we have a valid hangout url set, mark it as not pending anymore.
            var wasUnfarmed = this.get("hangout-pending");
            this.set("hangout-pending", null);

			// let anyone who was waiting for a hangout url from this session know
			// that we have a valid one now.
			this.trigger("hangout-url", url);

            // If no one is in this hangout, set a timeout to invalidate our
            // hangout URL if no one joins.
            if (this.getNumConnectedParticipants() == 0) {
                this._hangoutConnectionTimeout = setTimeout(_.bind(function() {
                    this.logAnalytics({action: "invalidate hangout url", url: url});
                    if (this.getNumConnectedParticipants() == 0) {
                        this.set("hangout-url", null);
                    }
                }, this), HANGOUT_CONNECTION_TIMEOUT);
            }
            this.logAnalytics({action: "set hangout url", url: url, wasUnfarmed: wasUnfarmed});
		} else {
            // If someone tries to overwrite an active hangout URL with a
            // different one, return false, so we can warn them what the
            // correct URL is.
            if (this.get("hangout-url") != url) {
                this.logAnalytics({
                    action: "double-set hangout url denied",
                    url: url,
                    existing: this.get("hangout-url")
                })
                return false;
            }
		}
        return true;
	},

	// in response to a live hangout telling us who is connected right now, 
	// update our internal representation of that list.
	setConnectedParticipants: function(participants) {
		client_models.Session.prototype.setConnectedParticipants.call(this, participants);

		// broadcast this change to all people in the event.
		if(this.collection.event) {
            var event = this.collection.event;
            event.trigger("broadcast", event, "session-participants", {
                id: this.id, participants: this.get("connectedParticipants")
            });
		}
        // Clear the timeout that would invalidate our hangout URL if no one
        // joined.
        if (this._hangoutConnectionTimeout) {
            clearTimeout(this._hangoutConnectionTimeout);
        }

		logger.debug("setting connected participants to: " + _.pluck(participants, "id"));
	},

    logAnalytics: function(opts) {
        logger.analytics(this.get("isPermalinkSession") ? "permalinks" : "sessions", _.extend({
            session: this,
            shortCode: this.get('shortCode'),
            event: this.collection && this.collection.event ? this.collection.event : null
        }, opts));
    },

	// We don't actually use this yet. We would only care about this when 
	// people don't want to name their new session themselves.
	generateCreationKey: function() {
		if(this.get("creationKey")) {
			logger.warn("Trying to generate a creation key for a session that already had one.");
			return;
		}

		var shasum = crypto.createHash('sha256');
		shasum.update(new Date().getTime() + "");
		shasum.update(exports.USER_KEY_SALT);

		this.set("creationKey", shasum.digest('hex').slice(0, 6));
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

		// sanitize the text so people can't put HTML or javascript or whatever
		// in their messages and cause trouble.
		if(this.has("text")) {
			this.set("text", sanitize(this.get("text")).escape());
		}
	}
});

exports.ServerChatList = client_models.ChatMessageList.extend({
	model: exports.ServerChatMessage,

	MAX_HISTORY: 5,

	initialize: function(options) {
		client_models.ChatMessageList.prototype.initialize.call(this, options);
	},

	push: function(item) {
		client_models.ChatMessageList.prototype.push.call(this, item);

		if(this.length > this.MAX_HISTORY) {
			return this.shift();
		}
	}
});


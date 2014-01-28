(function () {
  var server = false,
		models, Backbone;
		
  if (typeof exports !== 'undefined') {
    models = exports;
    server = true;

	// This is include-able both in a browser environment and in a v8/node env,
	// so it needs to figure out which situation it is in. If it's on the server,
	// put everything in exports and behave like a module. If it's on the client,
	// fake it and expect the client to understand how to deal with things.
	var _ = require('underscore')._,
	    Backbone = require('backbone');

  } else {
    models = this.models = {};

	// I'm a little unclear about why I need to do this, but if I don't,
	// Backbone isn't available in scope here. 
	Backbone = window.Backbone;
	_ = window._;
  }

// this is a stupid little shim to deal with not having the pagination module working.
// there should be some way to include it here, but I can't see to work it out.
if(server) {
    Backbone.Paginator = {};

    Backbone.Paginator.clientPager = Backbone.Collection;
}


// The base model objects in unhangout are quite straightforward. They are mostly just 
// collections of attributes with some helper methods for editing and reading
// those attributes in appropriate ways. Most of the complex behavior happens
// in the server-models.js extensions of these objects.

// The event model. Events are the top level object, and have many sessions within them.
models.Event = Backbone.Model.extend({
	idRoot: "event",
	urlRoot: "event",
	
	defaults: function() {
		return {
			title: "",
			organizer: "",
			shortName: null,		// use this as a slug for nicer urls
			description: "",
			welcomeMessage: null,
			start: null,
			end: null,
			connectedUsers: null,			// these two fields are setup in initialize
			sessions: null,
			youtubeEmbed: null,
			sessionsOpen: false,
			blurDisabled: false,
			dateAndTime: null,
            admins: []
		}
	},
	
	initialize: function() {
		// these are the main sub-collections of this model.
		this.set("sessions", new models.SessionList(null, this));
		this.set("connectedUsers", new models.UserList());
	},
			
	numUsersConnected: function() {
		return this.get("connectedUsers").length;
	},
	
	toJSON: function() {
		var attrs = _.clone(this.attributes);
		
		// delete transient attributes that shouldn't
		// be saved to redis.
		delete attrs["connectedUsers"];
		
		// for now just delete sessions; they'll save separately and will know their
		// event by id + url.
		delete attrs["sessions"];
		
		return attrs;
	},
	
	toClientJSON: function() {
		return _.clone(this.attributes);
	},
	
	addSession: function(session) {
		this.get("sessions").add(session);
		session.trigger("change:collection");
	},

	removeSession: function(session) {
		this.get("sessions").remove(session);
		session.trigger("change:collection");
	},

	openSessions: function() {
		this.set("sessionsOpen", true);
		this.trigger("open-sessions");
	},

	closeSessions: function() {
		this.set("sessionsOpen", false);
		this.trigger("close-sessions");
	},

	sessionsOpen: function() {
		return this.get("sessionsOpen");
	},
		
	url: function() {
		// okay this is sort of stupid, but we want to have a fixed width 
		// url because that makes it easier to match events from redis with
		// the loader. We want to use ??? selectors instead of *, which 
		// matches /event/id/session/id as well as /event/id
		return this.urlRoot + "/" + pad(this.id, 5);
	},
	
	setEmbed: function(ytId) {
		this.set("youtubeEmbed", ytId);
	},

	hasEmbed: function() {
		return this.has("youtubeEmbed") && this.get("youtubeEmbed").length>0;
	},

	isLive: function() {
        var curTime = new Date().getTime();
        var test = !_.isNull(this.get("start")) && curTime >= this.get("start") && _.isNull(this.get("end"));
        return test;
    },

	start: function() {
		if(this.isLive()) {
			return new Error("Tried to start an event that was already live.");
		} else {
			this.set("start", new Date().getTime());
			this.set("end", null);
		}
	},

	stop: function() {
		if(!this.isLive()) {
			return new Error("Tried to stop an event that was already live.");
		} else {
			this.set("end", new Date().getTime());
		}
	},

    getRoomId: function() {
        return this.id ? "event/" + this.id : null
    },

    // Add the given user -- either a full user model, or an object with an
    // "email" key -- to the list of admins, if not already present.
    addAdmin: function(user) {
        var admins = this.get("admins");
        var exists = _.any(admins, _.bind(function(admin) {
            return this.adminMatchesUser(admin, user);
        }, this));
        if (!exists) {
            var changed = false;
            if (user.id) {
                admins.push({id: user.id});
                changed = true;
            } else {
                var email;
                if (user.email) {
                    email = user.email;
                } else if (user.get && user.get("emails")[0]) {
                    email = user.get("emails")[0].value;
                }
                if (email) {
                    admins.push({email: email});
                    changed = true;
                }
            }
            if (changed) {
                this.set("admins", admins);
                this.trigger("change:admins", this, admins);
                this.trigger("change", this);
            }
        }
    },
    // Remove the given user -- either a full user model, or an object with an
    // "email" key -- from the list of admins, if present.
    removeAdmin: function(user) {
        var admins = this.get("admins");
        admins = _.reject(admins, _.bind(function(admin) {
            if (this.adminMatchesUser(admin, user)) {
                changed = true;    
                return true;
            }
            return false;
        }, this));
        if (changed) {
            this.set("admins", admins);
            this.trigger("change:admins", this, admins);
            this.trigger("change", this);
        }
    },
    // "admins" is a list of Admin objects, which refer to a user.  However,
    // the user may or may not exist in the system yet (e.g. may have never
    // logged in).  The admin object thus represents users in two ways:
    //
    // 1. by id (preferred):
    //      { id: <user.id>}
    // 2. by email:
    //      { email: <email> }
    //
    // This utility function matches a compares a user (either a full user
    // model or an object with like {email: <email>}) to see if it matches
    // the given admin object.
    adminMatchesUser: function(admin, user) {
        var userId = user.id;
        var emails;
        if (user.get && user.get('emails')) {
            emails = _.pluck(user.get("emails"), "value");
        } else if (user.email) {
            emails = [user.email]
        } else {
            emails = [];
        }
        return ((!_.isUndefined(admin.id) && admin.id == userId) ||
                (admin.email && _.contains(emails, admin.email)));
    },
    userIsAdmin: function(user) {
        var admins = this.get("admins");
        return _.some(admins, _.bind(function(admin) {
            return this.adminMatchesUser(admin, user);
        }, this));
    },
    // Given an admin obj and a list of users, return a user in the list
    // matching the admin, or undefined if not found.
    findAdminAsUser: function(admin, userList) {
        if (!_.isUndefined(admin.id)) {
            return userList.get(admin.id);
        }
        return userList.findByEmail(admin.email);
    }
});

models.EventList = Backbone.Collection.extend({
	model: models.Event,
    getSessionById: function(sessionId) {
        var session;
        var event = this.find(function(event) {
            session = event.get("sessions").get(sessionId);
            if (session) {
                return true;
            }
        });
        return session;
    },
    // Returns true if the user is an admin of any of the events contained in
    // this collection.
    userIsAdmin: function(user) {
        return _.some(this.models, function(event) {
            return event.userIsAdmin(user);
        });
    }
});

// Sessions are the individual meetings that make up an event. Sessions
// (potentially) have a hangout connected to them. 
models.Session = Backbone.Model.extend({
	idRoot: "session",
	MAX_ATTENDEES: 10,

	defaults: function() {
		return {
			title: "",
			description: "",
			started: true,
			connectedParticipants: [],
            activities: [],
			hangoutConnected: false,
			shortCode: null
		};
	},
	isLive: function() {
		return true;
	},
    getRoomId: function() {
        return this.id ? "session/" + this.id : null
    },
    addConnectedParticipant: function(user) {
        var participants = _.clone(this.get("connectedParticipants"));
        if (!_.findWhere(participants, { id: user.id }) && participants.length < 10) {
            participants.push(user);
            return this.setConnectedParticipants(participants);
        }
        return false;
    },
    removeConnectedParticipant: function(user) {
        var participants = this.get("connectedParticipants");
        var newParticipants = _.reject(participants, function (u) {
            return u.id == user.id
        });
        return this.setConnectedParticipants(newParticipants);
    },
	setConnectedParticipants: function(users) {
        if (users.length > 10) { return false; }
        // Clean incoming users..
        users = _.map(users, function(u) {
            u = (u.toJSON ? u.toJSON() : u);
            return {
                id: u.id,
                displayName: u.displayName,
                picture: u.picture || (u.image && u.image.url ? u.image.url : "")
            }
        });
        // Has anything changed?
        var current = this.get("connectedParticipants");
        var intersection = _.intersection(_.pluck(users, "id"), _.pluck(current, "id"));
        if (users.length != current.length || intersection.length != current.length) {
            // We've changed.
            this.set("connectedParticipants", users);
            return true;
        } else {
            // No change.
            return false;
        }
	},
	getNumConnectedParticipants: function() {
		return this.get("connectedParticipants").length;
	},
    validate: function(attrs, options) {
        if (!_.isArray(attrs.activities)) {
            return "Missing activities.";
        }
        for (var i = 0; i < attrs.activities.length; i++) {
            var activity = attrs.activities[i];
            if (!_.contains(["video", "webpage", "about"], activity.type)) {
                return "Invalid activity type: " + activity.type;
            }
        }
    }
});

models.SessionList = Backbone.Collection.extend({
	model:models.Session,
	
	// sould not ever be called.	
	url: function() {
		console.log("GETTING LOCAL SESSION LIST");
		return "WAT";
	}
});

models.User = Backbone.Model.extend({

	defaults: function() {
        return {
            picture: "",
            superuser: false,
            isBlurred: false,
            displayName: "[unknown]",
            link: null,
            emails: []
        }
	},
	
	initialize: function() {
		this.checkJSON();
		this.on("change:_json", this.checkJSON)
	},
	
	checkJSON: function() {
		// _json (which comes from g+) has some extra stuff in it
		// that we might want to extract for our own purposes.
		if(this.has("_json")) {
			var json = this.get("_json");

			// some checking for situations where a user doesn't
			// have a google+ profile picture.
			if("picture" in json) { 
				this.set("picture", json.picture);
			}
			else { this.set("picture", "")}

			if("link" in json) this.set("link", this.get("_json").link);
		}	

		if(!this.has("admin"))	 {
			this.set("admin", false);
		}
	},

    isSuperuser: function() {
        return !!this.get("superuser");
    },

    hasEmail: function(email) {
        return !_.isUndefined(email) && _.contains(_.pluck(this.get('emails', 'value')), email);
    },

	isAdminOf: function(event) {
        if (this.isSuperuser()) { return true; }
        if (!event) { return false; }

        return event.userIsAdmin(this);
	},

	isBlurred: function() {
		return this.get("isBlurred");
	},

	setBlurred: function(blurred) {
		this.set("isBlurred", blurred);
		this.trigger("change");
		this.trigger("change:isBlurred");
	},

	getShortDisplayName: function() {
		// the goal here is to return first name, last initial
		// minor catch: we want to special handle last names that are hyphenated and turn
		// Alice-Bob -> A-B

		var names = this.get("displayName").split(" ");

		var shortDisplayName = names[0];

		_.each(names.slice(1, names.length), function(name) {

			if(name.indexOf("-")==-1) {
				// if we don't find a dash, just take the first letter
				shortDisplayName = shortDisplayName + " " + name.slice(0, 1);				
			} else {
				// if we do find a dash, then split on the dash and take the first letter of 
				// each.
				var hyphenatedNames = name.split("-");

				shortDisplayName = shortDisplayName + " " + hyphenatedNames[0].slice(0, 1) + "-" + hyphenatedNames[1].slice(0, 1);
			}
		});

		return shortDisplayName;
	}
});

models.UserList = Backbone.Collection.extend({
	model:models.User,
    findByEmail: function(email) {
        return this.find(function(u) {
            return _.contains(_.pluck(u.get("emails"), "value"), email);
        });
    }
});


function pad(n, width, z) {
  z = z || '0';
  n = n + '';
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}


models.ChatMessage = Backbone.Model.extend({
	defaults: function() {
		return {
			text: "This is my awesome chat message.",
			time: new Date().getTime(),
			user: null,
			past: false
		};
	},
	
	initialize: function() {
		if(_.isUndefined(this.get("time"))) {
			this.set("time", new Date().getTime());
		}
	}
});

models.ChatMessageList = Backbone.Collection.extend({
	model:models.ChatMessage
});

})()



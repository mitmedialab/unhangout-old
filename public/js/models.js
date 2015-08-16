(function () {

// This is include-able both in a browser environment and in a v8/node env, so
// it needs to figure out which situation it is in. If it's on the server, put
// everything in exports and behave like a module. If it's on the client, use
// requirejs styling.  Either way, make sure a 'define' method is available to
// wrap our call in.
if (typeof define === "undefined") {
    var root = this;
    define = function(deps, callback) {
        if (typeof exports !== "undefined") {
            module.exports = callback();
        } else {
            root.models = callback();
        }
    };
}

define(["underscore", "backbone", "moment"], function(_, Backbone, moment) {

var models = {};
// Load dependencies if we're in server/node environment.
if (typeof exports !== 'undefined') {
    _ = require('underscore');
    Backbone = require('backbone');
    moment = require("moment");
}

models.BaseModel = Backbone.Model.extend({
    // Add something to a model property which is a list, and trigger the
    // 'change' event for that property if it has changed.
    listAdd: function(property, item, options) {
        if (!_.contains(list, item)) {
            var list = _.clone(list);
            list.push(item);
            // Will trigger changes, as it's a new list.
            this.set(property, list);
        }
    },
    // Remove something to a model property which is a list, and trigger the
    // 'change' event for that property if it has changed.
    listRemove: function(property, item) {
        var list = this.get(property);
        var length = list.length;
        list = _.without(list, item);
        if (list.length != length) {
            // will trigger changes, as it's a new list.
            this.set(property, list);
        }
    },

    // Register all of the events on a backbone object (collection or model)
    // which is a property of this model on this model.  This enables listeners
    // to be set up to process events pertaining to the collection.  The events
    // triggered will have the signature:
    //    (<property>:<original-event>, model, ..original-event-args..)
    // For example, for the property "sessions":
    //    ("sessions:add", event, session)
    //    ("sessions:change:title", event, session, "New title")
    registerSubEvents: function(property) {
        if (!this._subEventHandlers) {
            this._subEventHandlers = {};
        }
        var sub = this.get(property);
        this._subEventHandlers[property] = _.bind(function() {
            var params = Array.prototype.slice.call(arguments);
            params[0] = property + ":" + params[0];
            params.splice(1, 0, this);
            this.trigger.apply(this, params);
        }, this)
        this.listenTo(sub, "all", this._subEventHandlers[property])
    },
    // Unregister the events from `registerSubEvents`.
    unregisterSubEvents: function(property, sub) {
        var sub = sub || this.get(property);
        this.stopListening(sub, "all", this._subEventHandlers[property]);
        delete this._subEventHandlers[property];

    }
});

// The base model objects in unhangout are quite straightforward. They are mostly just
// collections of attributes with some helper methods for editing and reading
// those attributes in appropriate ways. Most of the complex behavior happens
// in the server-models.js extensions of these objects.

// The event model. Events are the top level object, and have many sessions within them.
models.Event = models.BaseModel.extend({
    idRoot: "event",
    urlRoot: "event",
    DATE_DISPLAY_FORMAT: "dddd MMM D, YYYY h:mm a",

    defaults: function() {
        return {
            title: "",
            organizer: "",
            shortName: null, // use this as a slug for nicer urls
            description: "",
            whiteboard: {message: null},
            open: false,
            connectedUsers: null,
            sessions: null,
            hoa: null,
            youtubeEmbed: null,
            previousVideoEmbeds: [],
            sessionsOpen: false,
            adminProposedSessions: true,
            dateAndTime: null,
            timeZoneValue: null,
            admins: []
        };
    },

    initialize: function() {
        // these are the main sub-collections of this model.
        this.set("sessions", new models.SessionList(null, this));
        this.set("connectedUsers", new models.UserList());
        this.initializeSubEvents();
    },
    
    initializeSubEvents: function() {
        // Replicate events from these sub-collections on the event. This lets
        // us use this model as a choke point for all socket traffic -- we need
        // only listen to change/add/etc. events triggered on this model to
        // initiate socket updates.
        this.registerSubEvents("sessions");
        this.registerSubEvents("connectedUsers");

        this.on("change:hoa", _.bind(function(event, hoa) {
            var prev = this.previous("hoa");
            if (prev && (!hoa || hoa.id != prev.id)) {
                this.unregisterSubEvents(null, prev);
            } else if (hoa && hoa.event != this) {
                hoa.event = this;
            }
            if (hoa && hoa.eventsRegisteredFor != this) {
                this.registerSubEvents("hoa");
                hoa.eventsRegisteredFor = this;
            }
        }, this));
        this.on("change:youtubeEmbed", _.bind(function(event, ytId) {
            // Prepend the current embed (if any) to the list of previous embeds
            // (if it's not already there), and set the current embed to the given
            // ytId.
            var prev = this.get("previousVideoEmbeds");
            if (ytId) {
                var val = {youtubeId: ytId};
                if (!_.findWhere(prev, val)) {
                    // Clone so that setting triggers change events.
                    prev = _.clone(prev);
                    prev.unshift(val);
                    this.set("previousVideoEmbeds", prev);
                }
            }
            this.set("youtubeEmbed", ytId);
        }, this));
    },

    getStartDate: function() {
      return moment(this.get("dateAndTime")).tz(this.get("timeZoneValue"));
    },

    formatDate: function() {
        var date = this.getStartDate();
        if (date && date.isValid()) {
            return date.format(this.DATE_DISPLAY_FORMAT) + " " + date.zoneName();
        }
        return "";
    },

    getEventUrl: function() {
        return "/event/" + (this.get("shortName") ? this.get("shortName") : this.id);
    },

    getChatArchiveUrl: function() {
        return "/public/logs/chat/" + this.id + ".txt";
    },

    toJSON: function() {
        var attrs = _.clone(this.attributes);

        // delete transient attributes that shouldn't
        // be saved to redis.
        delete attrs.connectedUsers;

        // for now just delete sessions; they'll save separately and will know their
        // event by id + url.
        delete attrs.sessions;
        delete attrs.hoa;

        return attrs;
    },

    url: function() {
        // okay this is sort of stupid, but we want to have a fixed width
        // url because that makes it easier to match events from redis with
        // the loader. We want to use ??? selectors instead of *, which
        // matches /event/id/session/id as well as /event/id
        return this.urlRoot + "/" + pad(this.id, 5);
    },

    getRoomId: function() {
        return this.id ? "event/" + this.id : null;
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
        var changed;
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
    // TODO: Remove by-email.  Right now, this only would affect tests.
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
            emails = [user.email];
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
            if (!session && event.get("hoa") && event.get("hoa").id == sessionId) {
                session = event.get("hoa");
            }
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
            // Description
            title: "",
            description: "",
            shortCode: null,
            proposedBy: null,
            // State
            connectedParticipants: [],
            joiningParticipants: [],
            activities: [],
            joinCap: this.MAX_ATTENDEES,
            approved: false,
            votes: 0,
            votedBy: []
        };
    },
    getRoomId: function() {
        return this.id ? "session/" + this.id : null;
    },
    _participantRepr: function(user) {
        var json = user.toJSON ? user.toJSON() : user;
        return {
            id: json.id,
            displayName: json.displayName,
            picture: json.picture || (json.image && json.image.url ? json.image.url : "")
        }
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
            return u.id == user.id;
        });
        return this.setConnectedParticipants(newParticipants);
    },
    setConnectedParticipants: function(users) {
        if (users.length > 10) { return false; }
        // Clean incoming users..
        users = _.map(users, this._participantRepr);
        var newUserIds = _.pluck(users, "id");
        var currentUserIds = _.pluck(this.get("connectedParticipants", "id"));

        // Have connectedParticipants changed?
        var intersection = _.intersection(newUserIds, currentUserIds);
        if (users.length != currentUserIds.length ||
                intersection.length != currentUserIds.length) {
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
    },
    getParticipationLink: function() {
        if (this.get("isHoA")) {
            return "/hoa-session/" + this.get("session-key");
        } else {
            return "/session/" + this.get("session-key");
        }
    }
});

models.SessionList = Backbone.Collection.extend({
    model:models.Session,

    // sould not ever be called.
    url: function() {
        console.log("ERROR; url called for models.SessionList");
        return "WAT";
    }
});

models.User = Backbone.Model.extend({
    // list of available permission keys for enumerating permissions
    PERMISSION_KEYS: ["createEvents", "farmHangouts"],

    defaults: function() {
        return {
            picture: "",
            perms: {},
            superuser: false,
            displayName: "[unknown]",
            link: null,
            emails: [],
            preferredContact: null,
            networkList: {}
        };
    },

    initialize: function() {
        this.checkJSON();
        this.on("change:_json", this.checkJSON);
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
            } else {
                this.set("picture", "");
            }

            if("link" in json) this.set("link", this.get("_json").link);
        }

        if(!this.has("admin"))     {
            this.set("admin", false);
        }
    },

    /*
     * Permissions
     */

    // Enumerate the permissions this user has, giving the current value of
    // each.  Note that unlike `hasPerm`, the value given does not take
    // super-user-ness into account.
    eachPerm: function(callback) {
        var perms = this.get("perms");
        _.each(this.PERMISSION_KEYS, function(key) {
            var humanKey = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
            callback(key, !!perms[key], humanKey);
        });
    },

    // Returns true if the user has permission `perm`.  For superusers, always
    // returns true.
    hasPerm: function(perm) {
        if (this.isSuperuser()) {
            return true;
        }
        var perms = this.get("perms");
        return !!perms && !!perms[perm];

    },

    setPerm: function(perm, val, options) {
        if (!this.get("perms")) {
            this.set("perms", {}, {silent: true});
        }
        this.get("perms")[perm] = val;
        if (!(options && options.silent)) {
            this.trigger("change:perms");
        }
    },

    isSuperuser: function() {
        return !!this.get("superuser");
    },

    // Returns true if the admin is allowed to administer a particular event.
    // For superusers, always returns true.
    isAdminOf: function(event) {
        if (this.isSuperuser()) { return true; }
        if (!event) { return false; }

        return event.userIsAdmin(this);
    },

    /*
     * Data access
     */
    hasEmail: function(email) {
        return !_.isUndefined(email) && _.contains(_.pluck(this.get('emails', 'value')), email);
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
            past: false,
            postAsAdmin: false
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

return models;
}); // End of define

})(); // End of module-level anonymous function

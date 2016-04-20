var client_models = require('../public/js/models.js'),
    chatLogging = require('./chat-logger'),
    logger = require('./logging').getLogger(),
    _ = require('underscore')._,
    crypto = require('crypto'),
    conf = require("./options"),
    utils = require("./utils"),
    deepCopy = require("deep-copy"),
    uuid = require('node-uuid');

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
    },
    // Strip out emails/etc.
    toClientJSON: function() {
        var props = {
            id: this.id,
            picture: this.get("picture"),
            displayName: this.get("displayName"),
            networkList: this.get("networkList"),
            sessionPreference: this.get("sessionPreference")
        };
        if (this.isSuperuser()) {
            props.superuser = true
        }
        return props;
    },

    changeNetworkList: function(eventId, atNameUserId, toggle) {
      var clone = deepCopy(this.get("networkList") || {});
      if (!clone[eventId]) {
        clone[eventId] = [];
      }
      if (_.contains(clone[eventId], atNameUserId)) {
        if (toggle) {
          logger.debug("REMOVE FROM NETWORK", atNameUserId);
          clone[eventId] = _.without(clone[eventId], atNameUserId);
          this.save({networkList: clone});
        }
      } else {
        clone[eventId].push(atNameUserId);
        logger.debug("ADD TO NETWORK", atNameUserId);
        this.save({networkList: clone});
      }
   },

   setSessionPreference: function(eventId, sessionId) {
        var pref = deepCopy(this.get("sessionPreference") || {});
        if(!pref[eventId] ||
            sessionId == null) {
            pref[eventId] = [];
        } 
        if(sessionId !== null) {
            pref[eventId].push(sessionId);
        }
        this.set("sessionPreference", pref); 
        this.save();   
   },
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
    },
    findByPermission: function(perm) {
        return this.filter(function(u) {
            return u.hasPerm(perm);
        });
    }
});

exports.ServerEventList = client_models.EventList.extend({
    model:exports.ServerEvent
});

var _stopHistory = function(history, key, subkey, subsubkey) {
    var obj = history[key + ""];
    if (obj) {
      obj = obj[subkey + ""];
    }
    if (obj) {
        if (typeof subsubkey !== "undefined") {
            obj = obj[subsubkey + ""];
        }
        if (obj.start !== null && !isNaN(obj.start)) {
            obj.total += Date.now() - obj.start;
            obj.start = null;
        }
    }
};
var _startHistory = function(history, key, subkey, subsubkey) {
    key = key + "";
    subkey = subkey + "";
    // Maybe create history[key].
    var obj = history[key];
    if (!obj) {
      obj = history[key] = {};
    }
    // Maybe create history[key][subkey].
    obj = history[key][subkey];
    if (!obj) {
        obj = history[key][subkey] = {};
    }
    // Maybe add subkey, if we have a subkey.
    if (typeof subsubkey !== "undefined") {
        subsubkey = subsubkey + "";
        obj = history[key][subkey][subsubkey];
        if (!obj) {
            obj = history[key][subkey][subsubkey] = {};
        }
    }
    // Set total and start.
    obj.total = obj.total || 0;
    obj.start = Date.now();
}

exports.ServerEvent = client_models.Event.extend({
    urlRoot: "event",
    idRoot: "event",

    defaults: function() {
        return _.extend(client_models.Event.prototype.defaults(), {
            overflowUserCap: 200,
            overflowMessage: "Apologies, but this event is currently over capacity! You can try again later to see if space has opened up.",
            // Store counters for which users have attended this event and
            // its sessions for how long.
            history: {"event": {}, "sessions": {}}
        });
    },

    initialize: function() {
        this.set("sessions", new exports.ServerSessionList([], {event:this}));
        this.set("connectedUsers", new exports.ServerUserList());
        this.set("recentMessages", new exports.ServerChatList());

        this.initChatLogger();
        this.on("change:timeZoneValue", function() {
            if (this.chatLogger) {
                this.chatLogger.close();
            }
            this.initChatLogger();
        });
        this.initializeSubEvents();
        this.registerSubEvents("recentMessages");
        this.on("change:hoa", function(event, hoa) {
            var prev = this.previous("hoa");
            if (this.prev && (!hoa || hoa.id != this.prev.id)) {
                this.prev.destroy();
            }
        }.bind(this));
        // If we get a brand new hangout broadcast ID, set it as the embeded
        // video for the event immediately.
        this.on("hoa:change:hangout-broadcast-id", function(event, hoa, hbid) {
            if (hbid !== null) {
                var visited = !!_.findWhere(event.get("previousVideoEmbeds"), {
                    youtubeId: hbid
                });
                if (!visited) {
                    event.save({youtubeEmbed: hbid});
                }
            }
        });
        this.stopAllHistory();
        this.bindHistoryEvents();
    },

    initChatLogger: function() {
        if (this.id) {
            this.chatLogger = chatLogging.getLoggerForEvent(this);
        } else {
            this.once("change:id", function() {
                if (!this.chatLogger) {
                    this.initChatLogger();
                }
            }.bind(this));
        }
    },

    // We keep history of event and session participation (basically, just the
    // amount of time one has been in an event or session) as an object of the
    // form:
    //     history: {
    //         events: {
    //             <userId>: { total: <time in ms>, start: <timestamp> }
    //         },
    //         sessions: {
    //             <sessionId>: {
    //                 <userId>: { total: <time in ms>, start: <timestamp> }
    //             }
    //         }
    //     }
    // Several different events -- joining, leaving, stopping and starting the
    // event, and removing sessions, all trigger updates to the history.
    bindHistoryEvents: function() {
        // Update history for event joins/leaves.
        this.get("connectedUsers").on({
            "add": function(user, connectedUsers, options) {
                this.startHistory("event", user.id);
            },
            "remove": function(user, connectedUsers, options) {
                this.stopHistory("event", user.id);
            }
        }, this);
        // Update history for session joins/leaves.
        this.on("sessions:change:connectedParticipants", function(event, session, cop) {
            if (!event.get("open")) {
                return;
            }
            var prev = session.previous("connectedParticipants");
            var added = _.difference(cop, prev);
            var removed = _.difference(prev, cop);
            _.each(added, function(user) {
                if (user.id) {
                    this.startHistory("sessions", session.id, user.id);
                }
            }.bind(this));
            _.each(removed, function(user) {
                if (user.id) {
                    this.stopHistory("sessions", session.id, user.id);
                }
            }.bind(this));
        });
        // Update history on session removal.
        this.on("sessions:remove", function(event, session) {
            if (this.history && this.history.sessions &&
                  this.history.sessions[session.id]) {
                _.each(this.history.sessions[session.id], function(userId) {
                    event.stopHistory("sessions", session.id, userId);
                });
            }
        }, this);
        // Update history on event start/stop
        this.on("change:open", function(event, open) {
            var func = open ? event.startHistory : event.stopHistory;
            event.get("connectedUsers").each(function(user) {
                func.call(event, "event", user.id);
            }.bind(this));
            event.get("sessions").each(function(session) {
                _.each(session.get("connectedParticipants"), function(user) {
                    if (user.id) {
                        func.call(event, "sessions", session.id, user.id);
                    }
                }.bind(this));
            }.bind(this));
        }, this);
    },

    // Stop all history that we have going.  Useful for clearing history in the
    // event of a server restart or similar.
    stopAllHistory: function() {
        var history = this.get("history");
        if (!history) {
            return;
        }
        for (var userId in history.event || {}) {
            _stopHistory(history, "event", userId);
        }
        for (var sessionId in history.sessions || {}) {
            for (var userId in history.sessions[sessionId]) {
                _stopHistory(history, "sessions", sessionId, userId);
            }
        }
    },

    // Start history for a particular thing.  Arguments come in to flavors:
    //    ("event", <userId>)
    //    ("sessions", <sessionId>, <userId>)
    startHistory: function(key, subkey, subsubkey) {
        this._updateHistory(function(history) {
            if (!this.get("open")) {
                return;
            }
            _startHistory(history, key, subkey, subsubkey);
        });
    },
    // Stop history for a particular thing.  Arguments come in to flavors:
    //    ("event", <userId>)
    //    ("sessions", <sessionId>, <userId>)
    stopHistory: function(key, subkey, subsubkey) {
        this._updateHistory(function(history) {
            _stopHistory(history, key, subkey, subsubkey);
        });
    },

    // Update history, persist it, and trigger change events.
    _updateHistory: function(cb) {
        var history = this.get("history");
        if (cb.call(this, history) !== false) {
            this.save({history: history});
            this.trigger("change:history", this, history);
            this.trigger("change", this);
        }
    },

    // Return a list of user IDs corresponding to those who shared a session
    // with the user wih given userId.  If specified, minTime constrains
    // returned userIds to only those users who were in the session longer than
    // minTime.  Returned results do not include the given userId.
    getUserIdsSharingSessionsWith: function(userId, minTime) {
        minTime = minTime || 0;
        var history = this.get("history");
        var userIds = {};
        _.each(history.sessions, function(usersTimes, sessionId) {
            if (!usersTimes[userId] || usersTimes[userId].total <= minTime) {
                return;
            }
            _.each(usersTimes, function(time, otherUserId) {
                if (otherUserId !== userId && time.total > minTime) {
                    userIds[otherUserId] = true;
                }
            });
        });
        return _.keys(userIds);
    },

    toJSON: function() {
        // Parent deletes 'sessions', 'hoa', etc.
        var attrs = client_models.Event.prototype.toJSON.call(this);
        // Also delete recentMessages, which we don't persist.
        delete attrs.recentMessages;
        return attrs;
    },

    toClientJSON: function() {
        var attrs = this.toJSON();
        attrs.formattedDate = this.formatDate();
        // Run 'toClientJSON' filtering on the original 'connectedUsers' collection.
        attrs.connectedUsers = this.get("connectedUsers").invoke("toClientJSON");
        return attrs;
    },

    logChat: function(chatMsg) {
        this.get("recentMessages").push(chatMsg);
        this.trigger("change:recentMessages", this, this.get("recentMessages"));
        this.trigger("change", this);
        if (!this.chatLogger) {
            logger.error("Trying to log with no logger: " + chatMsg, this);
        } else {
            this.chatLogger.log(chatMsg.get('user'), chatMsg.get('text'), chatMsg.get('time'));
        }
        this.logAnalytics({action: "chat", user: chatMsg.get('user')});
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
    // After a server restart, we want to wait a little while for participants
    // to rejoin, but then clear the hangout URL if no one has joined.  How
    // long should we wait for participants to rejoin before giving up on the
    // hangout and assigning people a new URL?  If the hangout was active, the
    // facilitator should post session participants very quickly. We can also
    // assume that G+ will keep the URL around for a little while.
    RESTART_HANGOUT_URL_EXPIRATION_TIMEOUT: 5 * 60 * 1000,
    // When starting a hangout with a farmed url, how long do we wait for the
    // first participant to join before we consider the hangout URL to be a
    // failure? This is an issue when, e.g., a apps-for-domains calendar link
    // makes it into the farm.  Take into account the time it takes for
    // people to click through Google+'s check-your-camera-and-join thing.
    HANGOUT_CONNECTION_TIMEOUT: 5 * 60 * 1000,
    // How long after the last person leaves the session should we stop the
    // hangout?  When a hangout is first starting, sometimes people get in
    // there, say "huh, no one's here", and leave, while others are in the
    // process of loading the app. This delay prevents the URL from getting
    // invalidated immediately.
    HANGOUT_LEAVE_STOP_TIMEOUT: 5 * 60 * 1000,
    // If a participant is creating a non-farmed hangout URL, how long do we
    // give them to complete the process before assuming they've skipped out?
    HANGOUT_CREATION_TIMEOUT: 60 * 1000,
    // If an event user clicks the "JOIN" button, we want to immediately
    // display their intention to join and reserve a slot, but free that slot
    // up if the user never shows up in the session.  How long do we wait
    // before freeing their slot?
    JOINING_EXPIRATION_TIMEOUT: 60 * 1000,

    defaults: function() {
        return _.extend(client_models.Session.prototype.defaults(), {
            // Identity
            "session-key": null,
            "creationKey": null, // TODO: Replace with "admins" for permalink sessions.
            "isPermalinkSession": false,
            "isHoA": false,
            // State
            "hangout-url": null,
            "hangout-pending": null,
            "hangout-start-time": null,
            "hangout-stop-request-time": null,
            // History
            "total-instances": 0,
            "total-seconds": 0
        });
    },

    initialize: function(args) {
        client_models.Session.prototype.initialize.call(this, args)
        _.bindAll(this, "onHangoutStarted", "onHangoutStopped")

        // Set up a hash to maintain timeouts for joinng users.
        this.joiningTimeouts = {};

        // make sure not to overwrite the built-in session-key
        // if we've loaded one through the db.
        if(_.isNull(this.get("session-key"))) {
            var sessionKey = uuid.v4();
            this.set("session-key", sessionKey);
        }
    },
    // Add a user to the list of `joiningParticipants` -- people who we're
    // pretty sure will be joining the hangout soon, but might not make it
    // there if they close the tab, don't have the plugin, etc.
    addJoiningParticipant: function(user, options) {
        if (!_.findWhere(this.get("connectedParticipants"), {id: user.id})) {
            var joining = this.get("joiningParticipants");
            if (!_.findWhere(joining, {id: user.id})) {
                joining.push(this._participantRepr(user));

                this.scheduleJoiningExpiration(user);
                if (!this.isDeleted) {
                    this.save();
                }
                if (!(options && options.silent)) {
                    this.trigger("change:joiningParticipants", this, joining, options || {});
                    this.trigger("change", this, options || {});
                }
            }
        }
    },
    // Remove a joining participant.  Call this on timeouts (when we're giving
    // up on the user joining) or if the user has connected.
    removeJoiningParticipant: function(user, options) {
        var joining = this.get("joiningParticipants");
        if (_.findWhere(joining, {id: user.id})) {
            joining = _.reject(joining, function(u) { return u.id == user.id; });
            this.set({"joiningParticipants": joining}, options || {});
            if (!this.isDeleted()) {
                this.save();
            }
        }
        if (this.joiningTimeouts[user.id]) {
            clearTimeout(this.joiningTimeouts[user.id]);
            delete this.joiningTimeouts[user.id];
        }
    },

    // Schedule a user (who is currently a joiningParticipant) to be removed
    // after a timeout.  This is split out so we can call it in onRestart in
    // the event that the server restarts in the middle of people joining a
    // session.
    scheduleJoiningExpiration: function(user) {
        if (this.joiningTimeouts[user.id]) {
            clearTimeout(this.joiningTimeouts[user.id]);
        }
        this.joiningTimeouts[user.id] = setTimeout(function() {
            this.removeJoiningParticipant(user);
        }.bind(this), this.JOINING_EXPIRATION_TIMEOUT);
    },
    getState: function() {
        // There are five parameters that contribute to the state:
        // `hangout-start-time`, `hangout-url`, `hangout-pending`,
        // `hangout-stop-request-time`, and `connectedParticipants`.  However, there
        // are only two fully valid and two limbo combinations of these:
        // valid:
        //  "started", "stopped"
        // limbo:
        //  "pending", "stopping"
        //
        // "started": {
        //     "hangout-start-time": <int>,
        //     "hangout-url": <string>,
        //     "hangout-pending": null,
        //     "hangout-stop-request-time": null,
        //     "connectedParticipants": [list of length more than 0],
        // }
        // "stopped": {
        //     "hangout-start-time": null,
        //     "hangout-url": null,
        //     "hangout-pending": null,
        //     "hangout-stop-request-time": null,
        //     "connectedParticipants": []
        // }
        // "pending": {
        //     "hangout-start-time": null,
        //     "hangout-url": null,
        //     "hangout-pending": null,
        //     "hangout-stop-request-time": null,
        //     "connectedParticipants": []
        // }
        // "stopping": {
        //     "hangout-start-time": <int>,
        //     "hangout-url": <string>,
        //     "hangout-pending": null,
        //     "hangout-stop-request-time": <timestamp integer>,
        //     "connectedParticipants": []
        // }
        //
        // Any other combination of values -- a hangout-url with zero
        // participants, a hangout-start-time with no hangout-url, etc. is an
        // error condition.

        var pending = !_.isNull(this.get("hangout-pending"));
        var pendingStale = pending && (
            (new Date().getTime() - this.get("hangout-pending").time) > this.HANGOUT_CREATION_TIMEOUT
        );
        var stopping = !_.isNull(this.get("hangout-stop-request-time"));
        var stoppingStale = stopping && (
            (new Date().getTime() - this.get("hangout-stop-request-time")) > this.HANGOUT_LEAVE_STOP_TIMEOUT
        );
        var hasUrl = _.isString(this.get("hangout-url"));
        var hasStartTime = _.isNumber(this.get("hangout-start-time"));
        var hasParticipants = this.getNumConnectedParticipants();

        //
        // Valid states
        //
        if (!pending && hasUrl && hasStartTime && hasParticipants && !stopping) {
            return "started";
        }
        if (!pending && !hasUrl && !hasStartTime && !hasParticipants && !stopping) {
            return "stopped";
        }
        if (pending && !pendingStale && !hasUrl && !hasStartTime && !hasParticipants && !stopping) {
            return "pending";
        }
        if (!pending && hasUrl && hasStartTime && !hasParticipants && stopping && !stoppingStale) {
            return "stopping";
        }

        //
        // Problem states
        //
        var problems = [];
        if (pendingStale) { problems.push("pending overdue"); }
        if (stoppingStale) { problems.push("stopping overdue"); }
        if (pending) { problems.push("uncleared pending"); }
        if (stopping) { problems.push("uncleared stopping"); }
        if (hasParticipants) {
            if (!hasUrl) { problems.push("no url"); }
            if (!hasStartTime) { problems.push("no start time"); }
        } else {
            if (hasUrl) { problems.push("stale url"); }
            if (hasStartTime) { problems.push("unstopped"); }
        }
        return problems.join("; ");
    },
    explainState: function() {
        var state = this.getState();
        if (state === "pending") {
            var timeout = this.HANGOUT_CREATION_TIMEOUT -
                (new Date().getTime() - this.get("hangout-pending").time);
            return "A user started creating an un-farmed hangout; waiting for them to complete this.  The operation will time out in " + moment.duration(timeout).humanize() + ".";
        } else if (state === "stopping") {
            var timeout = this.HANGOUT_LEAVE_STOP_TIMEOUT -
                (new Date().getTime() - this.get("hangout-stop-request-time"));
            return "Everyone has left; the hangout is scheduled to stop in " + moment.duration(timeout).humanize() + ".";
        } else if (state === "started") {
            return "The hangout is running with connected participants.";
        } else if (state === "stopped") {
            return "The hangout is fully stopped and no one is connected.";
        } else {
            var status = ["The session is in an inconsistent state."];
            if (state.indexOf("pending overdue") != -1) {
                status.push("It is stuck pending hangout creation.");
            }
            if (state.indexOf("no url") != -1) {
                status.push("It has participants but no hangout URL.");
            }
            if (state.indexOf("no start time") != -1) {
                status.push("It has participants but no start time.");
            }
            if (state.indexOf("stale url") != -1) {
                status.push("It has no participants, but has a hangout URL set.");
            }
            if (state.indexOf("unstopped") != -1) {
                status.push("It has no participants, but is counting time as though connected.");
            }
            if (state.indexOf("uncleared pending") != -1) {
                status.push("It is also still pending hangout creation.");
            }
            if (state.indexOf("stopping overdue") != -1) {
                status.push("Is overdue for being stopped.");
            }
            if (state.indexOf("uncleared stopping") != -1) {
                status.push("It is still scheduled to stop.");
            }
            return status.join(" ");
        }
    },
    stopWithDelay: function(requestTime) {
        // Stop immediately if we don't have a hangout URL to preserve.
        if (!this.get("hangout-url")) {
            return this.onHangoutStopped();
        }

        requestTime = requestTime || new Date().getTime();
        this.set("hangout-stop-request-time", requestTime);
        if (!this.isDeleted()) {
            this.save();
        }
        // Set the timeout interval, discounting given requestTime if any.
        var timeoutInterval = this.HANGOUT_LEAVE_STOP_TIMEOUT - (
            new Date().getTime() - requestTime
        );

        setTimeout(function() {
            // no-op if we've been deleted by an event admin.
            if (this.isDeleted()) {
                return;
            }
            // Stop if we're still have an outstanding request to do so.
            if (this.get("hangout-stop-request-time") !== null) {
                this.onHangoutStopped();
            }
        }.bind(this), timeoutInterval);
    },
    isDeleted: function() {
        // We are "deleted" if we're neither an HoA nor a permalink session,
        // and we lack a collection from which to establish a URL.
        return (
            (this.get("isHoA") && !this.event) ||
            (!this.get("isHoA") && !this.get("isPermalinkSession") && !this.collection)
        );
    },
    onHangoutStarted: function() {
        if (this.get("hangout-start-time") == null) {
            this.set("total-instances", this.get("total-instances") + 1);
            this.set("hangout-start-time", new Date().getTime());
        }
        if (!this.isDeleted) {
            this.save();
        }
        this.logAnalytics({action: "start"});
    },
    onHangoutStopped: function() {
        // clear the connected participants list, too, so it's properly
        // initialized for a future connection.
        this.set("connectedParticipants", []);
        this.set("hangout-url", null);
        this.set("hangout-pending", null);
        this.set("hangout-id", null);
        this.set("hangout-stop-request-time", null);

        if (this.get("hangout-start-time") != null) {
            var elapsed = new Date().getTime() - this.get("hangout-start-time");
            this.set("total-seconds", (this.get("total-seconds") || 0) + elapsed/1000);
        }
        this.set("hangout-start-time", null);
        if (!this.isDeleted()) {
            this.save();
        }
        this.logAnalytics({action: "stop"});
    },
    onRestart: function() {
        // This callback should be called when the server is restarted, to
        // reset state accordingly.

        // Clear any connected participants -- after restart, they will need to
        // reconnect.
        if (this.getNumConnectedParticipants() > 0) {
            logger.warn("Orphaned session users in " + this.id + ": " +
                        this.getNumConnectedParticipants());
            this.set("connectedParticipants", []);
        }
        // Schedule expiration for any currently joining participants.
        _.map(this.get("joiningParticipants"), this.scheduleJoiningExpiration.bind(this));

        if (this.get("hangout-stop-request-time")) {
            // If we have a pending request to stop the hangout, resume it.
            this.stopWithDelay(this.get("hangout-stop-request-time"));
        } else if (this.get("hangout-pending")) {
            // If we have a pending creation, resume expiration timer.
            this.schedulePendingHangoutExpiration();
        } else if (this.get("hangout-url")) {
            // Regardless, if we have a hangout url, expire it if no one
            // rejoins.
            setTimeout(function() {
                if (this.getNumConnectedParticipants() == 0) {
                    this.onHangoutStopped();
                }
            }.bind(this), this.RESTART_HANGOUT_URL_EXPIRATION_TIMEOUT);
        }
    },

    url: function() {
        // Permalinks and regular event sessions: delegate to collection for URL.
        return this.collection.url() + "/" + this.id;
    },

    // this is part of the non-farming-based strategy; we mark the user as
    // trying to start a hangout, and have anyone else who tries to join
    // wait on their hangout to phone home.
    markHangoutPending: function(user) {
        if(this.isHangoutPending()) {
            this.logAnalytics({action: "unfarmed start denied while pending", user: user});
            return new Error("Hangout is pending, cannot start it again");
        } else {
            // if a user is provided, add in the user id.
            var obj = {time: new Date().getTime()};
            if(user) {
                obj["userId"] = user.id;
            }
            this.set("hangout-pending", obj);
            this.schedulePendingHangoutExpiration();

            this.logAnalytics({action: "unfarmed start", user: user});
            return true;
        }
    },
    // Set a timeout which clears hangout-pending status to allow others to
    // start the hangout if this user did not.
    schedulePendingHangoutExpiration: function() {
        var obj = this.get("hangout-pending");

        var interval = new Date().getTime() - this.get("hangout-pending").time;
        setTimeout(function() {
            if (_.isEqual(this.get("hangout-pending"), obj)) {
                this.logAnalytics({action: "unfarmed start timeout"});
                this.onHangoutStopped();
                if (!this.isDeleted()) {
                    this.save();
                }
            }
        }.bind(this), this.HANGOUT_CREATION_TIMEOUT - interval);
    },

    isHangoutPending: function() {
        return !!this.get("hangout-pending");
    },

    setHangoutUrl: function(url, user, hangoutId) {
        // User parameter is only used for logging.
        if(_.isNull(this.get("hangout-url"))) {
            this.set("hangout-url", url);
            this.set("hangout-id", hangoutId);

            // if we have a valid hangout url set, mark it as not pending anymore.
            var wasUnfarmed = this.get("hangout-pending");
            this.set("hangout-pending", null);

            // let anyone who was waiting for a hangout url from this session know
            // that we have a valid one now.
            this.trigger("hangout-url", url);

            // If no one is in this hangout, set a timeout to invalidate our
            // hangout URL if no one joins.
            if (this.getNumConnectedParticipants() == 0) {
                setTimeout(function() {
                    if (this.getNumConnectedParticipants() == 0) {
                        this.logAnalytics({action: "invalidate hangout url", url: url});
                        if (this.getNumConnectedParticipants() == 0) {
                            this.set("hangout-url", null);
                            this.set("hangout-id", null);
                        }
                    }
                }.bind(this), this.HANGOUT_CONNECTION_TIMEOUT);
            }
            this.logAnalytics({action: "set hangout url",
                               url: url,
                               wasUnfarmed: wasUnfarmed,
                               user: user});
        } else {
            // If someone tries to overwrite an active hangout URL with a
            // different one, return false, so we can warn them what the
            // correct URL is.
            if (this.get("hangout-url") != url) {
                this.logAnalytics({
                    action: "double-set hangout url denied",
                    attemptedUrl: url,
                    attemptedId: hangoutId,
                    existing: this.get("hangout-url"),
                    user: user
                })
                // XXX: Logging this as error to try to debug this in production.
                logger.error("Double-set hangout url", _.extend({
                    attemptedUrl: url}, this.toJSON()));
                return false;
            }
        }
        return true;
    },

    // in response to a live hangout telling us who is connected right now,
    // update our internal representation of that list.
    setConnectedParticipants: function(participants) {
        // Parent handles connectedParticipants.
        var ret = client_models.Session.prototype.setConnectedParticipants.call(this, participants);
        
        // Handle joining participants -- remove them as "joining" if they are now "connected".
        var connectedParticipants = this.get("connectedParticipants");
        var joiningChanged = false;
        _.each(this.get("joiningParticipants"), function(joiningUser) {
            if (_.findWhere(connectedParticipants, {id: joiningUser.id})) {
                // withold broadcast until the end.
                this.removeJoiningParticipant(joiningUser, {silent: true});
                joiningChanged = true;
            }
        }.bind(this));
        if (joiningChanged) {
            this.trigger("change:joiningParticipants",
                         this,
                         this.get("joiningParticipants"),
                         {});
            this.trigger("change", this, {});
        }

        // Unset hangout-stop-request-time, if any.  This will prevent a
        // pending stop-with-delay from ending this session.
        this.set("hangout-stop-request-time", null);
        return ret;
    },

    setAssignedParticipants: function(userId) {
        if(this.get("randomized")) {
            var assignees = this.get("assignedParticipants");
            if(!assignees) {
                assignees = [];
            } 
            if(assignees.length < this.get("joinCap")) {  
                assignees.push(userId); 
                this.set("assignedParticipants", assignees);
                this.save();
                this.trigger("change:assignedParticipants",
                this, this.get("assignedParticipants"));
                return true;
            } 
        }  
        return false; 
    },

    removeAssignedParticipant: function(user) {
        if(this.get("randomized")) {
            var assignees = this.get("assignedParticipants");
            if(!assignees) {
                assignees = [];
            } else {
                var index = assignees.indexOf(user.get("id")); 
                if(index >=0 ) {
                    assignees.splice(index, 1);
                }
            }
            this.set("assignedParticipants", assignees);
            this.save();
            this.trigger("change:assignedParticipants",
                    this, this.get("assignedParticipants"));
        }
    },

    logAnalytics: function(opts, tag) {
        tag = tag || this.get("isPermalinkSession") ? "permalinks" : "sessions";
        logger.analytics(tag, _.extend({
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
    },
    toClientJSON: function() {
        return this.toJSON();
    }
});

// Overrides pertinent to Hangouts-on-Air.
exports.ServerHoASession = exports.ServerSession.extend({
    initialize: function() {
        exports.ServerSession.prototype.initialize.apply(this, arguments);
        // Much longer hangout creation timeout for HoA's. 
        this.HANGOUT_CREATION_TIMEOUT = 60 * 1000 * 15;
        this.set("isHoA", true);
    },
    defaults: function() {
        return _.extend(exports.ServerSession.prototype.defaults.call(this), {
            "isHoA": true,
            "hangout-broadcast-id": null
        });
    },
    url: function() {
        // Store in Redis with an /hoa/ namespace associated with the event.
        // Since we destroy old hoa's when adding a new one to an event, there
        // should only ever be one hoa per event.
        return this.event.url() + "/hoa/" + this.id;
    },
    logAnalytics: function(opts) {
        exports.ServerSession.prototype.logAnalytics.call(this, opts, "hoa");
    },
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
    toClientJSON: function() {
        var attrs = this.toJSON();
        attrs.user = this.get("user").toClientJSON();
        return attrs;
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


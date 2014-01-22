#!/usr/bin/env node

var EVENT_ID = 10;      // Must be an integer.  If it doesn't exist, we'll create it.
var NUM_SESSIONS = 50; // Sessions will get ID's "loadSession<n>" (string)
var NUM_USERS = 500;   // Users will get ID's "loadUser<n>" (string)
var REDIS_DB_ID = 1;

// ---------------------------------

var models = require("../lib/server-models"),
    logger = require("../lib/logging").getLogger(),
    conf = require("../conf.json"),
    UnhangoutDb = require("../lib/unhangout-db"),
    async = require("async"),
    _ = require("underscore");

// TODO: make this go unnecessary.  Duplicate options with un-prefixed names.
var options = _.extend({}, conf);
for (var key in options) {
    var prefix = "UNHANGOUT_";
    if (key.substring(0, prefix.length) == "UNHANGOUT_") {
        options[key.substring(prefix.length)] = options[key];
    }
}
options.persist = true;

var db;
function init(callback) {
    db = new UnhangoutDb(options);
    db.init(callback);
}
function destroy(callback) {
    // If this gets borked, you might find this command useful to delete all
    // loadSessions without going through the event:
    //   redis-cli keys "event/*/sessions/loadSession*" | xargs redis-cli del
 
    logger.info("Starting to delete load users, sessions, and event.");
    var models = [];
    var event = db.events.get(EVENT_ID);
    if (!event) {
        logger.error("Event " + EVENT_ID + " not found.");
        return callback();
    }
    var sessions = event.get("sessions");
    for (var i = 0; i < NUM_SESSIONS; i++) {
        models.push(sessions.get("loadSession" + i));
    }
    for (var i = 0; i < NUM_USERS; i++) {
        models.push(db.users.get("loadUser" + i));
    }
    async.map(models, function(model, done) {
        if (!model) { return done(); }
        logger.info("del " + model.url());
        model.destroy({
            success: function() { done(); },
            error: function(err) { done(err); }
        });
    }, function(err) {
        if (err) {
            logger.error(err);
            return done();
        }
        logger.info("del " + event.url());
        event.destroy({
            success: function() {
                callback();
            },
            error: function(err) {
                logger.error(err);
                callback();
            }
        });
    });
}

function create(callback) {
    // Create an event, sessions, and users for the given parameters.
    logger.info("Starting to generate load test models.");
    async.waterfall([
        // Create event
        function(done) {
            var event = db.events.get(EVENT_ID);
            if (event) {
                event.start();
                logger.info("Event " + EVENT_ID + " already exists.");
            } else {
                logger.info("Creating Event " + EVENT_ID);
                event = new models.ServerEvent({
                    id: EVENT_ID,
                    title: "Load Test Event"
                });
            }
            event.save({}, {
                success: function() { done(null, event); },
                error: function() { done(err); }
            });
        },
        // Create sessions
        function(event, done) {
            var sessionIds = [];
            var sessions = event.get("sessions");
            for (var i = 0; i < NUM_SESSIONS; i++) {
                sessionIds.push("loadSession" + i);
            }

            async.map(sessionIds, function(sessionId, done) {
                var session = sessions.get(sessionId);
                if (session) {
                    logger.info("Session " + sessionId + " already exists.");
                    return done(null, session);
                } else {
                    logger.info("Creating Session " + sessionId);
                    session = new models.ServerSession({
                        id: sessionId,
                        event: event,
                        title: "Session " + sessionId
                    });
                    sessions.add(session);
                    session.save({}, {
                        success: function() { return done(null); },
                        error: function(err) { return done(err); }
                    });
                }
            }, function(err) {
                if (err) { return done(err); }
                event.save({sessions: sessions}, {
                    success:  function() {
                        done(null, event);
                    },
                    error: function(err) {
                        console.log("Event err");
                        done(err);
                    }
                });
            });
        },
        // Create users
        function(event, done) {
            var userIds = [];
            for (var i = 0; i < NUM_USERS; i++) {
                userIds.push("loadUser" + i);
            }
            async.map(userIds, function(userId, done) {
                var user = db.users.get(userId);
                if (user) {
                    logger.info("user " + userId + " already exists.");
                    return done(null, user);
                } else {
                    logger.info("Creating User " + userId);
                    user = new models.ServerUser({id: userId, displayName: userId});
                    user.save({}, {
                        success: function() { done(null, user); },
                        error: function(err) { done(err); }
                    });
                }
            }, function(err, userModels) {
                if (err) { return done(err); }
                db.users.add(userModels);
                done();
            });
        }
    ], function(err) {
        if (err) {
            logger.error(err)
        } else {
            logger.info("Done.");
            callback();
        }
    });
}

if (require.main === module) {
    init(function(err) {
        if (err) {
            logger.error(err);
            process.exit();
        }
        if (_.contains(process.argv, "--delete")) {
            destroy(function() { process.exit(); });
        } else {
            create(function() { process.exit(); });
        }
    });
}

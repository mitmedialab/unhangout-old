#!/usr/bin/env node

// Prepare data for bin/load-simulator.js to use.  See bin/load-simulator.js
// for full instructions/explanation.

var models = require("../lib/server-models"),
    logger = require("../lib/logging").getLogger(),
    simConf = require("../simulatorConf.js").SERVER,
    UnhangoutDb = require("../lib/unhangout-db"),
    async = require("async"),
    _ = require("underscore"),
    Promise = require("bluebird");


var db;
function init(callback) {
    var options = require("../lib/options");
    options.UNHANGOUT_REDIS_DB = simConf.REDIS_DB_ID;
    db = new UnhangoutDb(options);
    db.init(callback);
}
function destroy(callback) {
    // If this gets borked, you might find this command useful to delete all
    // loadSessions without going through the event:
    //   redis-cli keys "event/*/sessions/loadSession*" | xargs redis-cli del

    logger.info("Starting to delete load users, sessions, and event.");
    var models = [];
    var event = db.events.get(simConf.EVENT_ID);
    if (!event) {
        logger.error("Event " + simConf.EVENT_ID + " not found.");
        return callback();
    }
    models = models.concat(event.getRandomizedSessions());
    var sessions = event.get("sessions");
    for (var i = simConf.SESSION_RANGE[0]; i < simConf.SESSION_RANGE[1]; i++) {
        models.push(sessions.get("loadSession" + i));
    }
    for (var i = simConf.USER_RANGE[0]; i < simConf.USER_RANGE[1]; i++) {
        models.push(db.users.get("loadUser" + i));
    }
    async.map(models, function(model, done) {
        if (!model) { return done(); }
        logger.info("del " + model.url());
        model.destroy({
            success: function() {
                done();
            },
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
            var event = db.events.get(simConf.EVENT_ID);
            var sessionMode = simConf.SESSION_MODE || "admin";
            if (event) {
                logger.info("Event " + simConf.EVENT_ID + " already exists.");
            } else {
                logger.info("Creating Event " + simConf.EVENT_ID);
                event = new models.ServerEvent({
                    id: simConf.EVENT_ID,
                    title: "Load Test Event",
                });
            }
            event.save({
                open: true,
                sessionsOpen: true,
                adminProposedSessions: sessionMode === "admin",
                randomizedSessions: sessionMode === "randomized",
                history: {},
            }, {
                success: function() { done(null, event); },
                error: function() { done(err); }
            });
        },
        // Delete stale sessions
        function(event, done) {
            if (event.get("randomizedSessions")) {
                Promise.all(_.map(event.getRandomizedSessions(), function(sess) {
                    return new Promise(function(resolve, reject) {
                        sess.destroy({success: resolve, error: reject});
                    });
                }))
                .then(function() { done(null, event); })
                .catch(function(err) { done(err, event); });
            } else {
              done(null, event);
            }
        },
        // Create new sessions
        function(event, done) {
            var sessionIds = [];
            var sessions = event.get("sessions");
            for (var i = simConf.SESSION_RANGE[0]; i < simConf.SESSION_RANGE[1]; i++) {
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
                        title: "Session " + sessionId,
                        approved: true
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
            for (var i = simConf.USER_RANGE[0]; i < simConf.USER_RANGE[1]; i++) {
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
            logger.error(err);
            callback(err);
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

var logger = require('./logging').getLogger(),
    _ = require('underscore'),
    events = require('events'),
    redis_lib = require('redis'),
    async = require('async'),
    models = require("./server-models"),
    sync = require('./../lib/redis-sync');

var UnhangoutDb = function(options) {
    this.options = options;
};

_.extend(UnhangoutDb.prototype, events.EventEmitter.prototype, {
    init: function(callback) {
        _.bindAll(this, "loadModels");

        var redis = redis_lib.createClient(parseInt(this.options.REDIS_PORT), this.options.REDIS_HOST);
        this.users = new models.ServerUserList();
        this.events = new models.ServerEventList();
        this.permalinkSessions = new models.ServerSessionList();

        redis.auth(this.options.REDIS_PASSWORD);
        redis.on("end", function() { logger.error("redis end"); });
        redis.on("error", function() { logger.error("redis error: " + err); });
        redis.on("ready", function() { logger.info("redis ready"); });
        redis.once("ready", _.bind(function(err) {
            if (err) {
                logger.error("Error connecting to redis: " + err);
                this.emit("error", "Error connecting to redis: " + err);
                return callback && callback(err);
            }
            
            redis.select(this.options.REDIS_DB, _.bind(function() {
                sync.init(logger, redis);
                sync.setPersist(this.options.persist);
                this.loadModels(_.bind(function(err) {
                    if (err) {
                        logger.error("Error loading models from redis: " + err);
                    } else {
                        logger.info("Loaded " + this.users.length + " users from redis.");
                        logger.info("loaded " + this.events.length + " events from redis.");
                        var counter = 0;
                        this.events.each(function(event) {
                            counter += event.get("sessions").length;
                        });
                        logger.info("Loaded " + counter + " sessions from redis.");
                        this.emit("inited");
                    }
                    callback && callback(err);
                }, this));
            }, this));
        }, this));
        this.redis = redis;

    },
    loadModels: function(callback) {
        // Okay, this looks scary but it's relatively simple.  Basically, the
        // loaders set up methods that we call with a simple JS object
        // representing each of the objects of that type in redis. It simply
        // needs to construct matching objects.  To add a new type, just add a
        // matching entry in loaders and follow the format.
        var that = this;
        var loaders = [
            ["user/*", function(callback, attrs, key) {
                var newUser = new models.ServerUser(attrs);
                // no need to save since we're pulling from the
                // database to begin with.
                that.users.add(newUser);
                callback();
            }],

            ["event/?????", function(callback, attrs, key) {
                var newEvent = new models.ServerEvent(attrs);               
                that.events.add(newEvent);
                callback();
            }],

            ["event/*/sessions/*", function(callback, attrs, key) {
                var eventId = parseInt(key.split("/")[1]);

                var event = that.events.get(eventId);
                var newSession = new models.ServerSession(attrs);
                event.addSession(newSession);
                
                callback();
            }],

            ["session/permalink/*", function(callback, attrs, key) {
                var newSession = new models.ServerSession(attrs);

                // force these to be true. This fixes a transient condition where some
                // keys in the db didn't have this set and it defaults to false.dw
                newSession.set("isPermalinkSession", true);

                that.permalinkSessions.add(newSession);
                callback();
            }]
        ];
        // This mess is doing three things:
        // 1) figuring out all the key names of all the objects of this type in redis
        // 2) running mget to grab all those json strings at once
        // 3) calling the loader callbacks with parsed versions of those JSON strings
        function load (loader, done) {
            var redisKey = loader[0];
            var loadFunc = loader[1];
            logger.info("loading " + redisKey)
            async.waterfall([
                // Get the key names of all the objects of this type in redis.
                function (done) {
                    that.redis.keys(redisKey, function(err, modelKeys) {
                        if (err) {
                            return done(err);
                        }
                        if (modelKeys.length == 0) {
                            logger.warn("No redis data for " + redisKey);
                            return done(null, null);
                        }
                        return done(null, modelKeys);
                    });
                },
                // Grab all the JSON strings for those keys at once.
                function (modelKeys, done) {
                    if (!modelKeys) { return done(null, null); }
                    that.redis.mget(modelKeys, function(err, modelsJSON) {
                        if (err) { return done(err); }
                        // Return a zipped array of both keys and modelsJSON.
                        done(null, _.zip(modelKeys, modelsJSON));
                    });
                },
                // Call loader callbacks for each JSON string.
                function (keysAndAttrs, done) {
                    if (!keysAndAttrs) { return done(); }
                    async.map(keysAndAttrs, function(keyAndAttrs, cb) {
                        var key = keyAndAttrs[0];
                        var attrs = JSON.parse(keyAndAttrs[1]);
                        // Intentionally using '!= null', which evaluates true
                        // whether the arg is identical to `null` or identical
                        // to `undefined`. Allow strings and 0's through.
                        if (key != null && attrs != null) {
                            loadFunc(cb, attrs, key);
                        } else {
                            cb();
                        }
                    }, done);
                }
            ], done);
        };
        async.mapSeries(loaders, load, function(err, results) {
            logger.info("Done loading models.");
            callback();
        });

    }
});

module.exports = UnhangoutDb;

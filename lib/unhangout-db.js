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
        // needs to construct matching objects. This drives the crazy async
        // engine that follows. To add a new type, just add a matching entry in
        // loaders and follow the format.
        
        var loaders = {
            "user/*":_.bind(function(callback, attrs, key) {
                var newUser = new models.ServerUser(attrs);
                // no need to save since we're pulling from the
                // database to begin with.
                this.users.add(newUser);
                callback();
            }, this),
            
            "event/?????":_.bind(function(callback, attrs, key) {
                var newEvent = new models.ServerEvent(attrs);               
                this.events.add(newEvent);
                callback();
            }, this),
            
            "event/*/sessions/*":_.bind(function(callback, attrs, key) {
                var eventId = parseInt(key.split("/")[1]);

                var event = this.events.get(eventId);
                var newSession = new models.ServerSession(attrs);
                event.addSession(newSession);
                
                callback();
            }, this),

            "session/permalink/*":_.bind(function(callback, attrs, key) {
                var newSession = new models.ServerSession(attrs);

                // force these to be true. This fixes a transient condition where some
                // keys in the db didn't have this set and it defaults to false.dw
                newSession.set("isPermalinkSession", true);

                this.permalinkSessions.add(newSession);
                callback();
            }, this)
        };
        
        // This mess is doing three things:
        // 1) figuring out all the key names of all the objects of this type in redis
        // 2) running mget to grab all those json strings at once
        // 3) calling the loader callbacks with parsed versions of those JSON strings
        //
        // It seems worse than it is because of annoying async/map/bind wrappers, but
        // that's just to get all the closures configured right.
        async.series(_.map(_.pairs(loaders), _.bind(function(loader) {
            return _.bind(function(callback) {
                logger.info("loading " + loader[0]);
                this.redis.keys(loader[0], _.bind(function(err, modelKeys) {
                    if(modelKeys.length==0) {
                        callback(err);
                        return;
                    }
                    this.redis.mget(modelKeys, _.bind(function(err, modelsJSON) {
                        async.parallel(_.map(modelsJSON, _.bind(function(modelJSON, index) {
                            var key = modelKeys[index];
                            return _.bind(function(callback) {
                                var attrs = JSON.parse(modelJSON);
                                loader[1](callback, attrs, key);
                            }, this);
                        }, this)), function(err, result) {
                            callback();
                        });
                    }, this));
                }, this));
            }, this);
        }, this)), function(err, results) {
            logger.info("Done loading models.");
            callback();
        });

    }
});

module.exports = UnhangoutDb;

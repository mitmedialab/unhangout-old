var logger = require('../logging').getLogger(),
    _ = require('underscore'),
    couchdb_lib = require('cradle'),
    async = require('async'),
    models = require("../server-models"),
    sync = require('./couchdb-sync');

var filterViews = '_design/filter';

var driver = {
    name: "couchdb",
    init: function(unhangoutDb, callback) {
        couchdb_lib.setup({
            host: unhangoutDb.options.UNHANGOUT_COUCHDB_HOST,
            port: parseInt(unhangoutDb.options.UNHANGOUT_COUCHDB_PORT),
            cache: false,
            raw: false,
            forceSave: true,
        });
        var couchdbConnection = new(couchdb_lib.Connection)();
        var couchdb = couchdbConnection.database(unhangoutDb.options.UNHANGOUT_COUCHDB_DATABASE);

        var loadModels = function(modelsLoadedCallback) {
            // Okay, this looks scary but it's relatively simple.  Basically, the
            // loaders set up methods that we call with a simple JS object
            // representing each of the objects of that type in couchdb. It simply
            // needs to construct matching objects.  To add a new type, just add a
            // matching entry in loaders and follow the format.
            var loaders = [
                ["byUser", function(key, doc) {
                    var newUser = new models.ServerUser(doc);
                    // no need to save since we're pulling from the
                    // database to begin with.
                    unhangoutDb.users.add(newUser);
                }],

                ["byEvent", function(key, doc) {
                    var newEvent = new models.ServerEvent(doc);
                    unhangoutDb.events.add(newEvent);
                }],

                ["byEventHoa", function(key, doc) {
                    var eventId = parseInt(key.split("/")[1]);
                    var event = unhangoutDb.events.get(eventId);
                    var newSession = new models.ServerHoASession(doc);
                    newSession.event = event;
                    event.set("hoa", newSession);
                    newSession.onRestart();
                }],

                ["byEventSession", function(key, doc) {
                    var eventId = parseInt(key.split("/")[1]);

                    var event = unhangoutDb.events.get(eventId);
                    // Pass a collection to determine the URL. Note that this
                    // doesn't add the session to the collection yet; it just sets
                    // the Model.collection property.
                    var newSession = new models.ServerSession(doc, {
                        collection: event.get("sessions")
                    });
                    event.get("sessions").add(newSession);
                    // Reset state as needed.
                    newSession.onRestart();
                }],

                ["bySessionPermalink", function(key, doc) {
                    var newSession = new models.ServerSession(doc, {
                        collection: unhangoutDb.permalinkSessions
                    });

                    // force these to be true. This fixes a transient condition where some
                    // keys in the db didn't have this set and it defaults to false.dw
                    newSession.set("isPermalinkSession", true);
                    unhangoutDb.permalinkSessions.add(newSession);
                    // Reset state as needed.
                    newSession.onRestart();
                }],
            ];

            var load = function(loader, done) {
                var filter = loader[0];
                var loadFunc = loader[1];
                logger.info("loading " + filter)
                couchdb.view('filter/' + filter, function (err, res) {
                    if (err) { return done(err); }
                    res.forEach(function (key, doc) {
                        delete doc._id;
                        loadFunc(key, doc);
                    });
                    done();
                });

            };
            async.mapSeries(loaders, load, function(err, results) {
                logger.info("Done loading models.");
                modelsLoadedCallback(err);
            });

        }

        var viewCallback = function(callback, err) {
            if (err) {
                var message = "Error creating couchdb views: " + err;
                logger.error(message);
                unhangoutDb.emit("error", message);
            }
            else {
                callback();
            }
        }

        var updateViews = function() {
            logger.info("Updating filter views for couchdb.");
            // This programatically builds all of the views necessary for the
            // unhangout software to interact with the data in CouchDB. Views
            // are automatically updated on server restart, so it's ok to
            // change these on the fly, just be aware that if you add anything
            // else to this particular design doc it will not persist on
            // reboot!
            var viewOptions = {
              views: {
                  // Users.
                  byUser: {
                      map: "function (doc) { var patt = new RegExp('^user\/[0-9]+$'); if (patt.test(doc._id)) { emit(doc._id, doc); } }"
                  },
                  // Events.
                  byEvent: {
                      map: "function (doc) { var patt = new RegExp('^event\/[0-9]{5}$'); if (patt.test(doc._id)) { emit(doc._id, doc) } }"
                  },
                  // Event HOA sessions.
                  byEventHoa: {
                      map: "function (doc) { var patt = new RegExp('^event\/[0-9]{5}\/hoa\/[0-9]+$'); if (patt.test(doc._id)) { emit(doc._id, doc) } }"
                  },
                  // Event sessions.
                  byEventSession: {
                      map: "function (doc) { var patt = new RegExp('^event\/[0-9]{5}\/sessions\/[0-9]+$'); if (patt.test(doc._id)) { emit(doc._id, doc) } }"
                  },
                  // Permalink sessions.
                  bySessionPermalink: {
                      map: "function (doc) { var patt = new RegExp('^session\/permalink\/[0-9]+$'); if (patt.test(doc._id)) { emit(doc._id, doc) } }"
                  },
              }
            }
            var getViewsCallback = function (err, doc) {
                if (err) {
                    var message = "Error retrieving couchdb views: " + err;
                    logger.error(message);
                    unhangoutDb.emit("error", message);
                }
                else {
                    couchdb.save(filterViews, doc._rev, viewOptions, _.bind(viewCallback, {}, dbReady));
                }
            }
            couchdb.get(filterViews, getViewsCallback);
        }

        var dbReady = function() {
            sync.init(logger, couchdb);
            sync.setPersist(unhangoutDb.options.persist);
            var modelsLoaded = function(err) {
                if (err) {
                    logger.error("Error loading models from couchdb: " + err);
                } else {
                    logger.info("Loaded " + unhangoutDb.users.length + " users from couchdb.");
                    logger.info("loaded " + unhangoutDb.events.length + " events from couchdb.");
                    var counter = 0;
                    unhangoutDb.events.each(function(event) {
                        counter += event.get("sessions").length;
                    });
                    logger.info("Loaded " + counter + " sessions from couchdb.");
                    unhangoutDb.emit("inited");
                }
                callback && callback(err);
            }
            loadModels(modelsLoaded);
        }

        var dbExistsCallback = function (err, exists) {
            if (err) {
                var message = "Error connecting to couchdb: " + err;
                logger.error(message);
                unhangoutDb.emit("error", message);
            }
            else if (exists) {
                logger.info("CouchDB database " + unhangoutDb.options.UNHANGOUT_COUCHDB_DATABASE + " already exists.");
                updateViews();
            }
            else {
                var dbCreateCallback = function(err) {
                    if (err) {
                        var message = "Error creating couchdb database " + unhangoutDb.options.UNHANGOUT_COUCHDB_DATABASE + ": " + err;
                        logger.error(message);
                        unhangoutDb.emit("error", message);
                    }
                    else {
                        logger.info("CouchDB database " + unhangoutDb.options.UNHANGOUT_COUCHDB_DATABASE + " created.");
                        couchdb.save(filterViews, {}, _.bind(viewCallback, {}, updateViews));
                    }
                }
                couchdb.create(dbCreateCallback);
            }
        }
        couchdb.exists(dbExistsCallback);
    },
};

module.exports = driver;

var async = require('async'),
    Backbone = require('backbone');

// this module defines how backbone models should synchronize themselves.
// backbone provides a basic sync infrastructure, but it is designed
// to operate over http. In our case, we're interested only in syncing
// to a couchdb database that exists on the server. We also don't need
// to support all the different sync verbs (create/read/update/delete)
// just create and update.


// these must be set in init!
var couchdb = null;
var logger = null;

exports.init = function(l, r) {
    couchdb = r;
    logger = l;
    logger.info("couchdb-sync initialized");
}

// overriding sync per:
// http://documentcloud.github.com/backbone/#Sync
exports.sync = function(method, model, options) {
    if(!couchdb || !logger) {
        return;
    }

    var callback = function(err, doc) {
        if (err) {
            logger.error("couchdb error: " + err);
            options.error && options.error();
        }
        else {
            if (doc) {
                model.set('_rev', doc.rev);
            }
            options.success && options.success();
        }
    }

    /**
     * Returns a random integer between min (inclusive) and max (inclusive)
     */
    function getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // method – the CRUD method ("create", "read", "update", or "delete")
    // model – the model to be saved (or collection to be read)
    // options – success and error callbacks, and all other jQuery request options
    switch(method) {
        case "create":
            // if the model doesn't have an id yet, get one by looking at couchdb
            // for the next id. Each model type (eg session, event) has its own
            // id counter.
            if(model.id == null) {
                var counter = 'global:' + model.idRoot + '.next.id';
                var getNextId = function() {
                    var saveModel = function(err, count) {
                        if (err) {
                          setTimeout(getNextId, getRandomInt(50, 150));
                        }
                        else {
                            model.set("id", count);
                            couchdb.save(model.url(), model.toJSON(), function (err, doc) {
                                callback(err, doc);
                            });
                        }
                    }
                    couchdb.get(counter, function (err, doc) {
                        if (err) {
                            // No counter for this model yet created.
                            var count = 1;
                            couchdb.save(counter, {count: count}, function (err) {
                                saveModel(err, count);
                            });
                        }
                        else {
                            var count = doc.count + 1;
                            couchdb.save(counter, doc._rev, {count: count}, function (err) {
                                saveModel(err, count);
                            });
                        }
                    });
                }
                getNextId();
            } else {
                couchdb.save(model.url(), model.toJSON(), function (err, doc) {
                    callback(err, doc);
                });
            }
            break;
        case "update":
            var rev = model.get('_rev');
            if (rev) {
                couchdb.save(model.url(), rev, model.toJSON(), function (err, doc) {
                    callback(err, doc);
                });
            }
            else {
                couchdb.save(model.url(), model.toJSON(), function (err, doc) {
                    callback(err, doc);
                });
            }
            break;
        case "read":
            logger.error("Fetch is not supported with this sync function.");
            break;
        case "delete":
            couchdb.remove(model.url(), model.get('_rev'), function (err, res) {
                callback(err);
            });
            break;
    }
}

// We use the dummySync method as something we can override the built
// in sync method with to do nothing. This is useful when you want to test
// the server with persistence OFF, which most of our tests want to do for
// simplicity.
exports.dummySync = function(method, model, options) {
    return;
}

exports.setPersist = function(persist) {
    if(persist) {
        Backbone.sync = exports.sync;
    } else {
        Backbone.sync = exports.dummySync;
    }
}


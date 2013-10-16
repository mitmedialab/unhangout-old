var _ = require('underscore')._,
	async = require('async'),
    Backbone = require('backbone');

// this module defines how backbone models should synchronize themselves.
// backbone provides a basic sync infrastructure, but it is designed
// to operate over http. In our case, we're interested only in syncing
// to a redis database that exists on the server. We also don't need
// to support all the different sync verbs (create/read/update/delete)
// just create and update.


// these must be set in init!
var redis = null;
var logger = null;

exports.init = function(l, r) {
	redis = r;
	logger = l;
	logger.info("redis-sync initialized");
}

// overriding sync per:
// http://documentcloud.github.com/backbone/#Sync
exports.sync = function(method, model, options) {
	if(!redis || !logger) {
		return;
	}
	
	if(!redis.connected) {
		logger.err("tried to sync, but redis is not connected");
		return;
	}
	
    // method – the CRUD method ("create", "read", "update", or "delete")
    // model – the model to be saved (or collection to be read)
    // options – success and error callbacks, and all other jQuery request options
    // basically we can leverage redis' complete lack of caring about 
    // creating things explicitely and jump dump attributes into redis.
    switch(method) {
        case "create":
        	// if the model doesn't have an id yet, get one by looking at redis
        	// for the next id. Each model type (eg session, event) has its own
        	// id counter.

        	// after getting a new id, stringify the model and set it in redis.
            if(model.id==null) {
	            redis.incr('global:' + model.idRoot + ".next.id", function(err, res) {
					model.set("id", res);
					redis.set(model.url(), JSON.stringify(model.toJSON()));
					model.trigger("change:id", res);

	            	options.success && options.success();
				});
			} else {
				redis.set.call(redis,model.url(),JSON.stringify(model.toJSON()));
            	options.success && options.success();
			}
            break;
        case "update":
			// this is exactly the same as create, minus the id checking. 
			redis.set(model.url(), JSON.stringify(model.toJSON()));
            options.success && options.success();
            break;
        case "read":
			logger.error("Fetch is not supported with this sync function.");            
            break;
        case "delete":
            logger.error("Got a request to delete but we haven't implemented deleting yet.");
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


var nextIds = {};

// wrapper function to get the next id in the sequence.
exports.getNextId = function(model) {
    if(!(model.urlRoot in nextIds)) {
        nextIds[model.urlRoot] = 0;
    }
    
    return nextIds[model.urlRoot]++;
}

exports.resetIds = function() {
    nextIds = {};
}

exports.flush = function() {
    redis.flushdb();
}
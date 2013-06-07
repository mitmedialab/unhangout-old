var _ = require('underscore')._
    Backbone = require('backbone');


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
            if(model.id==null) {
	            redis.incr('global:' + model.urlRoot + ".next.id", function(err, res) {
					model.set("id", res);
					redis.set.call(redis,model.url(),JSON.stringify(model.toJSON()));
	            	options.success && options.success();
				});
			} else {
				redis.set.call(redis,model.url(),JSON.stringify(model.toJSON()));
            	options.success && options.success();
			}
            break;
        case "update":
            // we're using the model.url method to generate keys because semantically,
            // this is what .url() is supposed to be for if we were running on the 
            // client and syncing over http.
            redis.set.call(redis,model.url(),JSON.stringify(model.toJSON()));
            options.success && options.success();
            break;
        case "read":
            // given a collection, get all its bits.
            redis.keys(model.url() + "*", function(err, modelKeys) {
                if(modelKeys.length==0) {
                    options.success && options.success([]);
                    return [];
                }
                
                redis.mget(modelKeys, function(err, models) {
                    var parsed = _.map(models, function(model) {
                                        return JSON.parse(model);
                                    });
                    options.success && options.success(parsed);
                    return parsed;
                });
            });
            
            break;
        case "delete":
            logger.err("Got a request to delete but we haven't implemented deleting yet.");
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
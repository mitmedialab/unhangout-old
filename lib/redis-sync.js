var _ = require('underscore')._,
	async = require('async'),
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
					redis.set(model.url(), JSON.stringify(model.toJSON()));
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
			logger.err("Fetch is not supported with this sync function.");
            // given a collection, get all its bits.

			// if(model instanceof Backbone.Collection) {
					//             redis.keys(model.url() + "*", function(err, modelKeys) {
					// 	                if(modelKeys.length==0) {
					// 	                    options.success && options.success([]);
					// 	                    return [];
					// 	                }
					//                 	
					// // this might have big performance implications, who knows.
					// 
					// var queries = [];
					// _.each(modelKeys, function(modelKey) {
					// 	queries.push(function(callback) {
					// 			                redis.hgetall(modelKey, function(err, model) {
					// 			                	callback(err, model);
					// 		});
					// 	});
					// });
					// 					
					// async.series(queries, function(err, results) {
					// 	options.success && options.success(results);
					// });
					// 	            });
	
			// deferring this bit of functionality for now
			// } else if(model instanceof Backbone.Model) {
			// 			redis.get(model.url(), function(err, model) {
			// 				var model = 
			// 			});
			// 		}
            
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
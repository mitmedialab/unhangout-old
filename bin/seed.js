var models = require('../lib/server-models.js'),
_ = require('underscore')._;
sync = require('../lib/redis-sync.js'),
async = require('async'),
winston = require('winston'),
redis = require('redis')


var logger;

// This file populates the database with basic starter objects to make development easier and more predictable.
// typically run like this:
// node /bin/seed.js

exports.run = function(dbId, redis, callback) {
		redis.select(dbId, function(err) {
			if(err) {
				logger.error(err);
				return;
			}
			redis.flushdb(function(err) {
				if(err) {
					logger.error(err);
					return;
				}

				sync.init(logger, redis);
				sync.setPersist(true);

				logger.info("Starting seed.");

				var events = [];

				events.push(new models.ServerEvent({title:"Scratch Pedagodgy Unhangout", organizer: "MIT Media Lab & ConnectedLearning.tv",
				description: "Come join us to talk about how to use Scratch in an educational environment. Aimed at educators, parents, and administrators interested in sharing best practices, learning from experts, and taking their Scratch curricula to the next level.",
				start: new Date().getTime(), end: new Date().getTime()+60*60*2*1000}));

				events.push(new models.ServerEvent({title:"Open Source Learning Unhangout", organizer: "MIT Media Lab & ConnectedLearning.tv",
				description: "There are more online resources for education than ever, but how to make sense of them all? Do they have a role in a traditional classroom? For life long learners? Come share your favorite resources, discover new ones, and get inspired about how to bring open educational resources into your classroom.",
				start: new Date().getTime()+60*60*24*4*1000, end: new Date().getTime()+60*60*24*4*1000 + 60*60*2*1000}));

				var sessions = [];
				
				sessions.push(new models.ServerSession());
				sessions.push(new models.ServerSession());
				sessions.push(new models.ServerSession());
				sessions.push(new models.ServerSession());
				sessions.push(new models.ServerSession());
				sessions.push(new models.ServerSession());

				events[0].addSession(sessions[0]);
				events[0].addSession(sessions[1]);
				events[0].addSession(sessions[2]);

				events[1].addSession(sessions[3]);
				events[1].addSession(sessions[4]);
				events[1].addSession(sessions[5]);


				async.series(_.map(_.union(events, sessions), function(model) {
					return function(callback) {
						model.save(null, {success:function() {
							callback();
						}});
					};
				}), function(err, res) {
					callback && callback();
				});
			});
		});
}


if(require.main === module) 
{ 
	
    logger = new (winston.Logger)({
		transports: [
		new (winston.transports.Console)(
			{
				timestamp: true
			})
			],
		});
		
	logger.cli();

	logger.info("Called seeds directly; running on main redis db.");
	
	var r = redis.createClient();
	r.on("connect", function() {
		exports.run(0, r, function() {
			process.exit();
		});		
	})
} else {
	logger = new (winston.Logger)({
		transports: [
		new (winston.transports.File)(
			{
				filename: "seed.log",
				timestamp: true
			})
			],
		});
}

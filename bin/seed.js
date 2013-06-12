var models = require('../public/js/models.js'),
_ = require('underscore')._;
sync = require('../lib/redis-sync.js'),
winston = require('winston'),
redis = require('redis').createClient();


var logger= new (winston.Logger)({
	transports: [
	new (winston.transports.Console)(
		{
			timestamp: true
		})
		],
		levels: winston.config.syslog.levels
	});

redis.on("connect", function() {

	redis.flushdb(function(err) {
		sync.init(logger, redis);
		sync.setPersist(true);

		logger.info("Starting seed.");


		var events = [];

		events.push(new models.Event({id:0, title:"Scratch Pedagodgy Unhangout", organizer: "MIT Media Lab & ConnectedLearning.tv",
		description: "Come join us to talk about how to use Scratch in an educational environment. Aimed at educators, parents, and administrators interested in sharing best practices, learning from experts, and taking their Scratch curricula to the next level.",
		start: new Date().getTime(), end: new Date().getTime()+60*60*2*1000}));

		events.push(new models.Event({id:1, title:"Open Source Learning Unhangout", organizer: "MIT Media Lab & ConnectedLearning.tv",
		description: "There are more online resources for education than ever, but how to make sense of them all? Do they have a role in a traditional classroom? For life long learners? Come share your favorite resources, discover new ones, and get inspired about how to bring open educational resources into your classroom.",
		start: new Date().getTime()+60*60*24*4*1000, end: new Date().getTime()+60*60*24*4*1000 + 60*60*2*1000}));

		_.each(events, function(event) {
			event.save();
			logger.info("Saved event: " + event.id);
		});

		process.exit();
		
	});
});


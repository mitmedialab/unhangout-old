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

				events.push(new models.ServerEvent({title:"Writers at Work", organizer: "National Writing Program & ConnectedLearning.tv",
				description: "Throughout July, NWP partnered with Connected Learning TV to host a webinar series called Writers at Work: Making and Connected Learning. As a wrap-up to our series we invite you to regroup here to debrief with us, test and tinker with this new unHangout tool, and continue the great conversations that have been started! We will start with a whole group kick-off and then split up into smaller group discussions, based on themes and topics raised by the seminar series. Please be aware that this is a “beta-test webinar” so your adventurous spirit is welcome!",
				start: new Date().getTime(), end: new Date().getTime()+60*60*2*1000}));

				// events.push(new models.ServerEvent({title:"Open Source Learning Unhangout", organizer: "MIT Media Lab & ConnectedLearning.tv",
				// description: "There are more online resources for education than ever, but how to make sense of them all? Do they have a role in a traditional classroom? For life long learners? Come share your favorite resources, discover new ones, and get inspired about how to bring open educational resources into your classroom.",
				// start: new Date().getTime()+60*60*24*4*1000, end: new Date().getTime()+60*60*24*4*1000 + 60*60*2*1000}));

				var sessions = [];
				
				sessions.push(new models.ServerSession({title:"Writing as Making/Making as Writing", description: "This webinar featured both inside and outside of school educators and media makers to discuss the impact of thinking about what happens when you put the learner front and enter in the role of producer. Facilitated by Elyse Eidman-Aadahl, NWP."}));
				sessions.push(new models.ServerSession({title:"What does interest-driven look like?", description:"This webinar featured both inside and outside of school educators and researchers discussing what interest-driven means and what it looks like in connected learning. Facilitated by Stephanie West-Puckett, TRWP"}));
				sessions.push(new models.ServerSession({title:"What we've been learning in #clmooc", description:"Not yet a webinar but actually a MOOC (“Massively Open Online Collaboration”) that the NWP also hosted throughout the month of July, this webinar is an opportunity to see what’s been made and what’s been learned. Facilitated by Paul Oh, NWP."}));
				sessions.push(new models.ServerSession({title:"From Expression to Impact: Youth Civic Engagement Enacted", description:"This webinar explored how are educators fostering civic engagement in Connected Learning environments, how these contexts are changing and how best to support educators in doing this work with their students. Facilitated by Antero Garcia, CSUWP"}));
				sessions.push(new models.ServerSession({title:"Connected Learning TV now and into the future", description:"Connected Learning TV is in the middle of a 12-month experiment where we take 1 month at a time to focus on key connected learning communities and topics/themes. What have you found most useful about this format? What do you wish was different? What would make it easier for you (and your peers) to get involved in the series and the Connected Learning community? Facilitated by Jon Barilone, CLTV"}));

				events[0].addSession(sessions[0], true);
				events[0].addSession(sessions[1], true);
				events[0].addSession(sessions[2], true);
				events[0].addSession(sessions[3], true);
				events[0].addSession(sessions[4], true);

				// events[0].addSession(sessions[5]);
				// events[0].addSession(sessions[6]);
				// events[0].addSession(sessions[7]);
				// events[0].addSession(sessions[8]);
				// events[0].addSession(sessions[9]);

				// events[1].addSession(sessions[10]);
				// events[1].addSession(sessions[11]);
				// events[1].addSession(sessions[12]);

				_.each(sessions, function(session) {
					if(_.isUndefined(session.collection)) {
						logger.info("found undefined collection for name: " + session.get("name"));
					}
				});

				logger.info("sessions: " + sessions.length);

				async.series(_.map(_.union(events, sessions), function(model) {

					return function(callback) {
						// logger.info("saving " + JSON.stringify(model.collection));
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

var moment = require('moment');
var googleapis = require('googleapis');
var GoogleToken = require('gapitoken');
var OAuth2Client = googleapis.OAuth2Client;
var logger = require("./logging").getLogger();

var oauth2Client;

var curDb;

var numHangoutUrlsAvailable = 0;

// The rationale for this crazy situation is covered in DEVELOPMENT.md

exports.init = function(app, db, options) {
	curDb = db;
	
	// keep track of the total number of hangout urls we've farmed so far, so we
	// can put it in the UI.
	db.redis.llen('global:hangout_urls', function(err, len) {
		numHangoutUrlsAvailable = len;
	});

	// set up an HTTP endpoint that will put us in the endpoint redirect loop
	// people who load this url 
	app.get('/hangout-farming', function(req, res){
        if (!(req.isAuthenticated() && req.user.isSuperuser())) {
            return res.send(401, "Permission Denied");
        }
		var url = req.protocol + "://" + options.HOST + ":" + options.PORT + "/hangout-callback";

		// initialize an oauth client request, using our google client id
		oauth2Client =
		new OAuth2Client(options.GOOGLE_CLIENT_ID, options.GOOGLE_CLIENT_SECRET, url);

		var url = oauth2Client.generateAuthUrl({
			access_type: 'offline',
			scope: 'https://www.googleapis.com/auth/calendar'
		});

		// redirect the request to the google calendar api
		res.redirect(url);
	});

	// users who complete the authentication request will get redirected back here
	// from google, after they authorize our app. The request they make back to
	// our server will have a token attached to it, that we will use to 
	// place requests on behalf of this user.
	app.get('/hangout-callback', function(req, res) {
        if (!(req.isAuthenticated() && req.user.isSuperuser())) {
            return res.send(401, "Permission Denied");
        }
		// console.log(req.query["code"]);
		oauth2Client.getToken(req.query["code"], function(err, token) {
			if(err) {
				res.send(500, "Error getting token.");
				return;
			}

			oauth2Client.credentials = token;

			// okay, we've got a token now.	lets actually issue a request.
			// all we're doing here is creating a calendar event.
			googleapis.discover('calendar', 'v3').execute(function(err, client) {
				var now = moment().format();

				client.calendar
				.events
				.insert({
					calendarId: 'primary'}, {
						summary: 'hangout',
						description: 'hangout',
						anyoneCanAddSelf: true,
						visibility: "public",
						transparency: "transparent",
						reminders: {
							overrides: {
								method: 'popup',
								minutes: 0
							}
						},
						start: {
							dateTime: moment().add('days', 1).format()
						},
						end: {
							dateTime: moment().add('days', 1).add('hours', 1).format()
						},
						attendees: []
					})
					.withAuthClient(oauth2Client)
					.execute(function(err, event) {
						// this event fires when google tells us the calendar
						// event has been created. it includes the new calendar
						// event object.
						if(!err && "hangoutLink" in event) {
							// push it into redis for safekeeping. 
							db.redis.lpush("global:hangout_urls", event.hangoutLink, function(err, num) {
								logger.info("logged new hangout url: " + event.hangoutLink + "; total: " + num);
								// purely for convenience of clicking to farm another url.
								res.send("urls available: " + num + "<br><a href='//" + options.HOST + ":" + options.PORT + "/hangout-farming'>CLICK ME</a>");
								
								// update the tracking number.
								numHangoutUrlsAvailable = num;

								// TODO test whether it's okay to do this.
								// now delete the event so it doesn't clutter up the user's calendar.
								// as far as I can tell, 
								// client.calendar.events.delete({
								// 	calendarId:'primary',
								// 	eventId:event.id
								// 	}).withAuthClient(oauth2Client)
								// 	.execute();
							});
						} else {
							if(err) {
								res.send("There was an error creating a new calendar event on your calendar! <br>" + err + "; " + err.message + "; " + JSON.stringify(err));
							} else {
								// we send this error if the calendar event created doesn't have a hangout url
								// included in the object. Give the user some rudimentary instructions about
								// how to fix this situation.
								res.send("your account doesn't seem to have the 'create video calls for events I create' option enabled. go to <a href='http://calendar.google.com'>google calendar</a>, settings (in the upper right hand corner) and enable that option. Then <a href='http://" + options.HOST + ":" + options.PORT + "/hangout-farming'>CLICK HERE!</a><br>" + JSON.stringify(event));
							}
						}
					});
				});
				
		});
	});
	
	logger.info("registered hangout-faming urls");
}

// get a hangout url from redis
exports.getNextHangoutUrl = function(callback) {
	
	// just hit redis directly here, with an rpop.
	curDb.redis.rpop("global:hangout_urls", function(err, url) {
		logger.debug("returning hangout url: " + url + " (err: " + err + ")");
		callback && callback(err, url);
	});	
}

// put a hangout url back into redis that was unused
// (this situation occurs in some limited situations where people
//  join a new hangout in rapid succession)
exports.reuseUrl = function(url, callback) {
	curDb.redis.rpush("global:hangout_urls", url, function(err) {
		logger.debug("re-added a url that was no longer needed: " + url);
        if (callback) { callback(err); }
	});
}

// used for UI purposes
exports.getNumHangoutsAvailable = function() {
	return numHangoutUrlsAvailable;
}

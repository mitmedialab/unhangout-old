var moment = require('moment');
var googleapis = require('googleapis');
var GoogleToken = require('gapitoken');
var OAuth2Client = googleapis.OAuth2Client;

var oauth2Client;

var curApp;

exports.init = function(app) {
	curApp = app;
	
	app.express.get('/hangout-farming', function(req, res){
		var url = "http://" + app.options.HOST + ":" + app.options.PORT + "/hangout-callback";

		oauth2Client =
		new OAuth2Client(app.options.GOOGLE_CLIENT_ID, app.options.GOOGLE_CLIENT_SECRET, url);

		var url = oauth2Client.generateAuthUrl({
			access_type: 'offline',
			scope: 'https://www.googleapis.com/auth/calendar'
		});

		res.redirect(url);
	});

	app.express.get('/hangout-callback', function(req, res) {
		// console.log(req.query["code"]);
		oauth2Client.getToken(req.query["code"], function(err, token) {
			if(err) {
				res.send(500, "Error getting token.");
				return;
			}

			oauth2Client.credentials = token;
			// okay, we've got a token now.	lets actually issue a request.
			googleapis.discover('calendar', 'v3').execute(function(err, client) {
				var now = moment().format();

				client.calendar
				.events
				.insert({
					calendarId: 'primary',
					resource: {
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
							dateTime: moment().add('days', 30).format()
						},
						attendees: []
						}
					})
					.withAuthClient(oauth2Client)
					.execute(function(err, event) {
						if(!err && "hangoutLink" in event) {
							// push it into redis for safekeeping. 
							app.redis.lpush("global:hangout_urls", event.hangoutLink, function(err, num) {
								app.logger.info("logged new hangout url: " + event.hangoutLink + "; total: " + num);
								// purely for convenience of clicking to farm another url.
								res.send("urls available: " + num + "<br><a href='http://" + app.options.HOST + ":" + app.options.PORT + "/hangout-farming'>CLICK ME</a>");
								
								// now delete the event so it doesn't clutter up the user's calendar.
								// as far as I can tell, 
								// client.calendar.events.delete({
								// 	calendarId:'primary',
								// 	eventId:event.id
								// 	}).withAuthClient(oauth2Client)
								// 	.execute();
							});
						} else {
							res.send(err + "<br>" + "your account doesn't seem to have the 'create video calls for events I create' option enabled. go to <a href='http://calendar.google.com'>google calendar</a>, settings (in the upper right hand corner) and enable that option. Then <a href='http://" + app.options.HOST + ":" + app.options.PORT + "/hangout-farming'>CLICK HERE!</a>");
						}
					});
				});
				
		});
	});
	
	app.logger.info("registered hangout-faming urls");
}

exports.getNextHangoutUrl = function(callback) {
	
	// just hit redis directly here, with an rpop.
	curApp.redis.rpop("global:hangout_urls", function(err, url) {
		curApp.logger.debug("returning hangout url: " + url + " (err: " + err + ")");
		callback && callback(err, url);
	});	
}

exports.reuseUrl = function(url) {
	curApp.redis.rpush("global:hangout_urls", url, function(err) {
		curApp.logger.debug("re-added a url that was no longer needed: " + url);
	});
}
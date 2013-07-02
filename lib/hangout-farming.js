var moment = require('moment');
var googleapis = require('googleapis');
var GoogleToken = require('gapitoken');
var OAuth2Client = googleapis.OAuth2Client;

var oauth2Client;



exports.init = function(app) {
	app.express.get('/hangout-farming', function(req, res){
		var url = "http://" + app.options.HOST + ":" + app.options.PORT + "/hangout-callback";
		app.logger.info("setting callback url: " + url);
		
		oauth2Client =
		new OAuth2Client(app.options.GOOGLE_CLIENT_ID, app.options.GOOGLE_CLIENT_SECRET, url);

		var url = oauth2Client.generateAuthUrl({
			access_type: 'offline',
			scope: 'https://www.googleapis.com/auth/calendar'
		});

		res.redirect(url);
	});

	app.express.get('/hangout-callback', function(req, res) {
		console.log(req.query["code"]);
		oauth2Client.getToken(req.query["code"], function(err, token) {
			if(err) {
				console.log("error: " + err);
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
					calendarId: '7lhpii1mseo0724trc4ljmj5d8@group.calendar.google.com',
					resource: {
						summary: 'hangout',
						description: 'hangout',
						reminders: {
							overrides: {
								method: 'popup',
								minutes: 0
							}
						},
						start: {
							dateTime: now
						},
						end: {
							dateTime: now
						},
						attendees: [{
							email: 'drew.harry@gmail.com'
							}]
						}
					})
					.withAuthClient(oauth2Client)
					.execute(function(err, event) {
						app.logger.info(err);
						app.logger.info("event from google: " + JSON.stringify(event));
					});
				});
			res.send(200);
		});
	});
	
	app.logger.info("registered hangout-faming urls");
}

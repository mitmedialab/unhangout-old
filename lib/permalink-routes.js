var _ = require("underscore"),
    utils = require("./utils"),
    models = require("./server-models"),
    logger = require("./logging").getLogger();

var ensureSuperuser = utils.ensureSuperuser

module.exports = {
    route: function(app, db, options) {
		//---------------------------------------------------------//
		//						PERMALINKS 						   //
		//---------------------------------------------------------//

		app.get("/h/", utils.ensureAuthenticated, function(req, res) {
			res.render('permalink-intro.ejs');
		});

		app.get("/h/admin/:code/:key", utils.ensureAuthenticated, function(req, res) {
			var session = db.permalinkSessions.find(function(s) {
				return s.get("shortCode")===req.params.code;
			});

			if(_.isUndefined(session)) {
				logger.warn("Request for /h/admin/:code/:key with unknown session code: " + req.params.code);
				res.status(404);
				res.send();
				return;
			}

			if(req.params.key===session.get("creationKey")) {
				// now render the normal permalink view, but with the admin interface showing.
				res.render('permalink.ejs', {showAdmin: true, users:db.users, session:session });
			} else {
				logger.warn("Attempt to load /h/admin/:code/:key with invalid key for this session: " + req.params.key);
				res.status(403);
				res.send();
				return;
			}

		});

		app.get("/h/:code", utils.ensureAuthenticated, function(req, res) {
			logger.debug("GET /h/" +req.params.code + ": " + JSON.stringify(req.body))
			// okay, this is the permalink part of the site. if this key exists already,
			// then render an appropriate template immediately. if we don't have a 
			// session that matches this code, then create one and then render
			// the page.

			// validate shortcodes here. 
			var re = /^[A-Za-z0-9-_.+]*$/;
			if(!re.test(req.params.code)) {
				logger.warn("GET /h/" + req.params.code + " is not a valid hangout permalink");
				res.status(400);
				res.send();
				return;
			}


			var session = db.permalinkSessions.find(function(s) {
				return s.get("shortCode")===req.params.code;
			});

			if(_.isUndefined(session)) {
				logger.debug("No session found for shortcode: '" + req.params.code + "', creating a new one.");
				session = new models.ServerSession();

				session.set("isPermalinkSession", true);

				// use the specified code for the new session.
				session.set("shortCode", req.params.code);
				db.permalinkSessions.add(session);
				session.generateCreationKey();
				session.set("first-load", true);
				session.save();

				// now redirect them to the admin page for this session.
				logger.info("Redirecting to admin page for a new permalink session code.");
				res.redirect("/h/admin/" + req.params.code + "/" + session.get("creationKey"));
				return;
			}

			// the problem with this is that we don't actually have all users in the
			// hangout in our list of users. That only includes people who have logged
			// in here. Not sure what to do about this. We'll either have to force
			// people to google log in when they land on the page, OR we're
			// going to have to have the participant information sent from the
			// hangout app instead of just the ids involved.

			res.render('permalink.ejs', {showAdmin: false, users:db.users, session:session});

			// after rendering, drop the first-load 
			if(session.get("first-load")) {
				session.set("first-load", false);
				session.save();
			}
		});
		
		app.post("/h/admin/:code", utils.ensureAuthenticated, function(req, res) {
			logger.info("POST /h/admin/"+ req.params.code + ": " + JSON.stringify(req.body));
			if(!("creationKey" in req.body)) {
				res.status(400);
				res.send();
				return;
			}

			// otherwise, if creationKey is present, check it against the specified session.
			var session = db.permalinkSessions.find(function(s) {
				return s.get("shortCode")==req.params.code;
			});

			if(_.isUndefined(session)) {
				logger.warn("sess:unknown (set title/desc)" + JSON.stringify(req.body));
				res.status(404);
				res.send();
				return;
			}

			if(req.body.creationKey===session.get("creationKey")) {
				session.set("title", req.body.title);
				session.set("description", req.body.description);
				session.save();

				logger.debug("updating session with params: " + JSON.stringify(req.body));

				res.redirect("/h/" + req.params.code);
			} else {
				logger.warn("POST to /h/admin/:code with invaid creationKey.");
				res.status(403);
				res.send();
				return;
			}
		});

		// this endpoint manually stops a shortcode session.
		// we seem to occasionally get sessions that are broken and stay open when
		// they're supposed to be closed. this lets us fix that issue.
		// this checks global admin status, not per-shortcode admin status.
		// we could at some point add this in to the permalink admin page, but I don't
		// think people actually go back to that.
		app.post("/h/:code/stop", utils.ensureAuthenticated, ensureSuperuser, function(req, res) {
			var session = db.permalinkSessions.find(function(s) {
				return s.get("shortCode")==req.params.code;
			});

			if(_.isUndefined(session)) {
				logger.warn("sess:unknown (stop)" + JSON.stringify(req.body));
				res.status(404);
				res.send();
				return;
			}

			// this will cascasde to trigger hangout-stopped, since we're hard-triggering a stop.
			session.set("hangoutConnected", false);
			res.redirect("/admin");
		});
    }
}

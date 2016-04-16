var moment = require('moment');
var googleapis = require('googleapis');
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
        if (!(req.isAuthenticated() && req.user.hasPerm("farmHangouts"))) {
            return res.send(401, "Permission Denied");
        }
        // We always want to farm with the backend instance, not the frontend
        // load balancer -- so prefer the ALT_AUTH_CALLBACK_DOMAIN to
        // options.baseUrl.
        var url = (options.ALT_AUTH_CALLBACK_DOMAIN || options.baseUrl) + "/hangout-callback";

        // initialize an oauth client request, using our google client id
        oauth2Client =
        new googleapis.OAuth2Client(
            options.UNHANGOUT_GOOGLE_CLIENT_ID,
            options.UNHANGOUT_GOOGLE_CLIENT_SECRET,
            url);

        var url = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: 'https://www.googleapis.com/auth/calendar'
        });

        // redirect the request to the google calendar api
        res.redirect(url);
    });

    var getCalendarEvent = function(code, callback) {
      try {
        oauth2Client.getToken(code, function(err, token) {
          if (err) { return callback(err); }
          oauth2Client.credentials = token;
          try {
            googleapis.discover('calendar', 'v3').execute(function(err, client) {
              if (err) { return callback(err); }
              try {
                var now = moment().format();
                var preppedClient = client.calendar
                  .events
                  .insert({calendarId: "primary"}, {
                      summary: 'hangout',
                      description: 'hangout',
                      anyoneCanAddSelf: true,
                      visibility: "public",
                      transparency: "transparent",
                      reminders: { overrides: { method: 'popup', minutes: 0 } },
                      start: {
                        dateTime: moment().add('days', 1).format()
                      },
                      end: {
                        dateTime: moment().add('days', 1).add('hours', 1).format()
                      },
                      attendees: []
                  }).withAuthClient(oauth2Client);
              } catch (e) {
                return callback(e);
              }
              try {
                preppedClient.execute(function(err, event) {
                  callback(err, event);
                });
              } catch (e) {
                return callback(e);
              }
            });
          } catch (e) {
            return callback(e);
          }
        });
      } catch (e) {
        return callback(e);
      }
    }
    // users who complete the authentication request will get redirected back here
    // from google, after they authorize our app. The request they make back to
    // our server will have a token attached to it, that we will use to
    // place requests on behalf of this user.
    app.get('/hangout-callback', function(req, res) {
        if (!(req.isAuthenticated() && req.user.hasPerm("farmHangouts"))) {
            return res.send(401, "Permission Denied");
        } else if (!req.query.code) {
            return res.send(400, "Missing code param.");
        }
        getCalendarEvent(req.query.code, function(err, event) {
            if (err) {
                logger.error("Error getting calendar event", err);
                return res.send(500, "Error getting calendar event: " + JSON.stringify(err));
            }
            if("hangoutLink" in event) {
                // push it into redis for safekeeping.
                db.redis.lpush("global:hangout_urls", event.hangoutLink, function(err, num) {
                    if (err) {
                        logger.error("Redis error", err);
                        return res.send(500, JSON.stringify(err));
                    }
                    // purely for convenience of clicking to farm another url.
                    res.send("urls available: " + num +
                         "<br><a href='" + (options.ALT_AUTH_CALLBACK_DOMAIN || options.baseUrl) + "/hangout-farming'>CLICK ME</a>");

                    // update the tracking number.
                    numHangoutUrlsAvailable = num;
                    logger.analytics("farming", {action: "create",
                                     url: event.hangoutLink, total: num});
                });
            } else {
                // we send this error if the calendar event created doesn't have a hangout url
                // included in the object. Give the user some rudimentary instructions about
                // how to fix this situation.
                var msg = "your account doesn't seem to have the 'create video calls for events I create' option enabled. go to <a href='http://calendar.google.com'>google calendar</a>, settings (in the upper right hand corner) and enable that option. Then <a href='" + options.baseUrl + "/hangout-farming'>CLICK HERE!</a><br>" + JSON.stringify(event);
                logger.error(msg);
                res.send(500, msg);
            }
        });
    });
};

// get a hangout url from redis
exports.getNextHangoutUrl = function(callback) {

    // just hit redis directly here, with an rpop.
    curDb.redis.rpop("global:hangout_urls", function(err, url) {
        if (!err) {
            numHangoutUrlsAvailable = Math.max(0, numHangoutUrlsAvailable - 1);
        }
        callback && callback(err, url);
        logger.analytics("farming", {action: "consume", url: url, total: numHangoutUrlsAvailable});
    });
}

// put a hangout url back into redis that was unused
// (this situation occurs in some limited situations where people
//  join a new hangout in rapid succession)
exports.reuseUrl = function(url, callback) {
    curDb.redis.rpush("global:hangout_urls", url, function(err, num) {
        logger.analytics("farming", {action: "recycle", url: url});
        logger.debug("re-added a url that was no longer needed: " + url);
        if (!err) {
            numHangoutUrlsAvailable = num;
        }
        if (callback) { callback(err); }
    });
}

// used for UI purposes
exports.getNumHangoutsAvailable = function() {
    return numHangoutUrlsAvailable;
}

// Remove all URLs from redis. Used only by tests.
exports.popAllUrls = function(callback) {
  var urls = [];
  exports.getNextHangoutUrl(function(err, url) {
    if (err) {
      return callback(err);
    } else if (url === null) {
      return callback(null, urls);
    } else {
      urls.push(url);
      return exports.popAllUrls(callback);
    }
  });
}

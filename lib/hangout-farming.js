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
};

// get a hangout url from redis
exports.getNextHangoutUrl = function(callback) {

    // just hit redis directly here, with an rpop.
    curDb.redis.rpop("global:hangout_urls", function(err, url) {
        if (!err) {
            numHangoutUrlsAvailable--;
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

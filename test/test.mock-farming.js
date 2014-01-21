var common = require("./common.js"),
    expect = require('expect.js'),
    request = require('superagent'),
    farming = require("../lib/hangout-farming"),
    googleapis = require('googleapis'),
    async = require('async');

var FARM_URL = "http://localhost:7777/hangout-farming";
var CALLBACK_URL = "http://localhost:7777/hangout-callback";
var MOCK_AUTH_URL = "http://example.com/mock-auth-url";
var MOCK_HANGOUT_URL = "http://example.com/mock-hangout-url";

/*
 * Monkey-patch the google out.
 */

var LINK_COUNTER = 0;
var CALENDAR_ERROR = null;
var RETURN_CALENDAR_EVENT = true;
var TOKEN_ERROR = null;

googleapis.OAuth2Client = function() {
    this.generateAuthUrl = function() {
        return MOCK_AUTH_URL;
    };
    this.getToken = function(code, callback) {
        return callback(TOKEN_ERROR, "mock-token");
    };
}

googleapis.discover = function(thingy, version) {
    return {
        execute: function(callback) {
            // Callback with a fake 'client'
            return callback(null, {
                calendar: {
                    events: {
                        insert: function(cal, opts) {
                            return {
                                withAuthClient: function(client) {
                                    return {
                                        execute: function(callback) {
                                            var event = {};
                                            if (RETURN_CALENDAR_EVENT && !CALENDAR_ERROR) {
                                                event.hangoutLink = MOCK_HANGOUT_URL + (++LINK_COUNTER);
                                            }
                                            return callback(CALENDAR_ERROR, event);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });
        }
    }
};

function checkFarmingDb(list, callback) {
    common.server.db.redis.lrange("global:hangout_urls", 0, 100, function(err, urls) {
        expect(urls).to.eql(list);
        callback(err);
    });
};

describe("FARMING", function() {
    beforeEach(common.standardSetup);
    afterEach(common.standardShutdown);

    it("test mock setup", function(done) {
        var OAuth2Client = require("googleapis").OAuth2Client;
        var oauth2Client = new OAuth2Client("client-id", "client-secret", "url");
        expect(oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: 'https://www.googleapis.com/auth/calendar'
        })).to.be(MOCK_AUTH_URL);
        expect(oauth2Client.getToken("code", function(err, token) {
            expect(err).to.be(null);
            expect(token).to.eql("mock-token");

            TOKEN_ERROR = "error!";
            oauth2Client.getToken("code", function(err, token) {
                expect(err).to.be("error!");
                expect(token).to.be("mock-token");
                TOKEN_ERROR = null;
                done();
            });
        }));

    });

    it("denies GET to hangout-farming from non-superusers", function(done) {
        request.get(FARM_URL)
            .set("x-mock-user", "admin1")
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(401)
                done()
            });
    });
    it("denies GET to hangout-callback from non-superusers", function(done) {
        request.get(CALLBACK_URL)
            .set("x-mock-user", "admin1")
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(401)
                done()
            });
    });
    it("allows GET to hangout-farming from superusers", function(done) {
        request.get(FARM_URL)
            .set("x-mock-user", "superuser1")
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(302);
                expect(res.headers.location).to.be(MOCK_AUTH_URL);
                done();
            });
    });
    it("farms URL with GET to hangout-callback", function(done) {
        LINK_COUNTER = 0;
        request.get(CALLBACK_URL)
            .set("x-mock-user", "superuser1")
            .end(function(res) {
                expect(res.status).to.be(200);
                var count = /urls available: (\d+)/.exec(res.text)[1];
                expect(count).to.be('1');
                expect(farming.getNumHangoutsAvailable()).to.be(1);
                checkFarmingDb([MOCK_HANGOUT_URL + "1"], done);
            });
    });
    it("displays error on token error", function(done) {
        TOKEN_ERROR = "error";
        request.get(CALLBACK_URL)
            .set("x-mock-user", "superuser1")
            .end(function(res) {
                TOKEN_ERROR = null; // reset global error state before any test failure
                expect(res.status).to.be(500);
                expect(res.text).to.eql("Error getting token.");
                expect(farming.getNumHangoutsAvailable()).to.be(0);
                checkFarmingDb([], done);
            });
    });
    it("displays error on calender error", function(done) {
        CALENDAR_ERROR = {message: "error"};
        request.get(CALLBACK_URL)
            .set("x-mock-user", "superuser1")
            .end(function(res) {
                CALENDAR_ERROR = null; // reset global error state before any test failure
                expect(res.status).to.be(200); // 200 status because it's not really our fault (?)
                expect(res.text).to.eql('There was an error creating a new calendar event on your calendar! <br>[object Object]; error; {"message":"error"}');
                expect(farming.getNumHangoutsAvailable()).to.be(0);
                checkFarmingDb([], done);
            });
    });
    it("displays an error on non-existing hangout link in event", function(done) {
        RETURN_CALENDAR_EVENT = false;
        request.get(CALLBACK_URL)
            .set("x-mock-user", "superuser1")
            .end(function(res) {
                RETURN_CALENDAR_EVENT = true; // reset global error state before any test failure
                expect(res.status).to.be(200); // 200 status because it's not really our fault (?)
                expect(
                    res.text.indexOf("account doesn't seem to have the 'create video calls")
                ).to.not.eql(-1);
                expect(farming.getNumHangoutsAvailable()).to.be(0);
                checkFarmingDb([], done);
            });
    });
    it("updates farming count on multiple adds", function(done) {
        LINK_COUNTER = 0;
        var reqs = [1,2,3,4,5,6,7,8,9,10];
        async.mapSeries(reqs, function(count, done) {
            request.get(CALLBACK_URL)
                .set("x-mock-user", "superuser1")
                .end(function(res) {
                    expect(res.status).to.be(200);
                    expect(res.text.indexOf("urls available: " + count)).to.not.eql(-1);
                    expect(farming.getNumHangoutsAvailable()).to.be(count);
                    done(null, res);
                });
        }, function(err, results) {
            var expectedUrls = [];
            for (var i = 0; i < reqs.length; i++) {
                expectedUrls.unshift(MOCK_HANGOUT_URL + reqs[i]);
            }
            checkFarmingDb(expectedUrls, done);
        });
    });
    it("updates farming count on consumption and recycling", function(done) {
        LINK_COUNTER = 0;
        var reqs = [1,2];
        async.mapSeries(reqs, function(count, done) {
            request.get(CALLBACK_URL).set("x-mock-user", "superuser1").end(function(res) { done(); });
        }, function() {
            expect(farming.getNumHangoutsAvailable()).to.be(reqs.length);
            farming.getNextHangoutUrl(function(err, url) {
                expect(url).to.eql(MOCK_HANGOUT_URL + reqs[0]);
                expect(farming.getNumHangoutsAvailable()).to.be(reqs.length - 1);
                checkFarmingDb([MOCK_HANGOUT_URL + reqs[1]], function() {
                    farming.reuseUrl(url, function() {
                        expect(farming.getNumHangoutsAvailable()).to.be(reqs.length);
                        checkFarmingDb([MOCK_HANGOUT_URL + reqs[1], MOCK_HANGOUT_URL + reqs[0]], done);
                    });
                });
            });
        });
    });
    it("returns null when no hangout-farming urls are available", function(done) {
        // At startup, none are available..
        farming.getNextHangoutUrl(function(err, url) {
            expect(err).to.be(null);
            expect(url).to.be(null);
            done();
        });
    });
});

var server = require('../lib/unhangout-server'),
	expect = require('expect.js'),
	_ = require('underscore')._,
	request = require('superagent'),
    options = require("../lib/options"),
    common = require('./common');

var event;

describe('HTTP ADMIN EVENTS API', function() {
	afterEach(common.standardShutdown);
    beforeEach(function(done) {
        common.standardSetup(function() {
            event = common.server.db.events.get(1);
            done();
        });
    });

    function checkEventTitle(titleSuffix, sockKey, done) {
        request.get("http://localhost:7777/event/" + event.id)
            .set("x-mock-user", sockKey)
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(200);
                expect(
                    res.text.indexOf("<title>" + event.get("title") +
                                     titleSuffix + " &mdash; powered by unhangout</title>")
                ).to.not.eql(-1);
                done();
            });
    }
    
    it("Shows event page when there aren't too many people.", function(done) {
        checkEventTitle("", "regular1", done);
    });
    it("Shows overflow page when there are too many people.", function(done) {
        var origCap = options.EVENT_USER_CAP;
        common.server.options.EVENT_USER_CAP = -1;
        checkEventTitle(" - Overflow", "regular1", function() {
            common.server.options.EVENT_USER_CAP = origCap;
            done();
        });
    });
    it("Does not send admin to overflow page.", function(done) {
        var origCap = options.EVENT_USER_CAP;
        common.server.options.EVENT_USER_CAP = -1;
        // ensure admin1 is an admin.
        expect(
            common.server.db.users.findWhere({"sock-key": "admin1"}).isAdminOf(event)
        ).to.be(true);
        common.server.options.EVENT_USER_CAP = -1;
        checkEventTitle("", "admin1", function() {
            common.server.options.EVENT_USER_CAP = origCap;
            done();
        });
    });
});

var server = require('../lib/unhangout-server'),
	expect = require('expect.js'),
	_ = require('underscore')._,
	request = require('superagent'),
    options = require("../lib/options"),
    common = require('./common');

var sock;
var session;

describe('HTTP ADMIN EVENTS API', function() {
	afterEach(common.standardShutdown);
    beforeEach(common.standardSetup);
    
    it("Shows event page when there aren't too many people.", function(done) {
        var event = common.server.db.events.get(1);
        request.get("http://localhost:7777/event/" + event.id)
            .set("x-mock-user", "regular1")
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(200);
                expect(
                    res.text.indexOf("<title>" + event.get("title") + " &mdash; powered by unhangout</title>")
                ).to.not.eql(-1);
                done();
            });
    });
    it("Shows overflow page when there are too many people.", function(done) {
        var event = common.server.db.events.get(1);
        var origCap = options.EVENT_USER_CAP;
        common.server.options.EVENT_USER_CAP = -1;

        request.get("http://localhost:7777/event/" + event.id)
            .set("x-mock-user", "regular1")
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(200);
                expect(
                    res.text.indexOf("<title>" + event.get("title") + " - Overflow &mdash; powered by unhangout</title>")
                ).to.not.eql(-1);
                common.server.options.EVENT_USER_CAP = origCap;
                done();
            });
    });
});

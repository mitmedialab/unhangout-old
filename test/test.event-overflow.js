var server = require('../lib/unhangout-server'),
    expect = require('expect.js'),
    _ = require('underscore')._,
    request = require('superagent'),
    options = require("../lib/options"),
    common = require('./common');

var event;

describe('EVENT OVERFLOW', function() {
    afterEach(common.standardShutdown);
    beforeEach(function(done) {
        common.standardSetup(function() {
            event = common.server.db.events.get(1);
            event.set({open: true});
            done();
        });
    });

    function checkEventTitle(titleSuffix, sockKey, done) {
        request.get(common.URL + "/event/" + event.id)
            .set("x-mock-user", sockKey)
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(200);
                var re = /<title>([^<]+)<\/title>/gm;
                var match = re.exec(res.text);
                expect(match[1]).to.eql(event.get("title") + titleSuffix +
                  " &mdash; powered by unhangout"
                );
                done();
            });
    }

    it("Shows event page when there aren't too many people.", function(done) {
        checkEventTitle("", "regular1", done);
    });

    it("Shows overflow page when there are too many people.", function(done) {
        event.set("overflowUserCap", 0);
        checkEventTitle(" - Overflow", "regular1", function() {
            event.set("overflowUserCap", 200);
            done();
        });
    });

    it("Does not send admin to overflow page.", function(done) {
        event.set("overflowUserCap", 0);
        // ensure admin1 is an admin.
        expect(
            common.server.db.users.findWhere({"sock-key": "admin1"}).isAdminOf(event)
        ).to.be(true);
        checkEventTitle("", "admin1", function() {
            event.set("overflowUserCap", 200);
            done();
        });
    });

    it("Shows custom overflowMessage.", function(done) {
        event.set("overflowMessage", "Hot diggity");
        request.get(common.URL + "/event/" + event.id)
            .set("x-mock-user", "regular1")
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(200);
                expect(res.text.indexOf("Hot diggity")).to.not.eql(-1);
                done();
            });
    })

});

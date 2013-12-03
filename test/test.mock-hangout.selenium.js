var expect = require('expect.js'),
    _ = require("underscore"),
    common = require('./common');

var browser = null,
    event = null,
    session = null;

describe("MOCK HANGOUT", function() {
    if (process.env.SKIP_SELENIUM_TESTS) {
        return;
    }
    this.timeout(40000); // Extra long timeout for selenium :(

    before(function(done) {
        common.getSeleniumBrowser(function (theBrowser) {
            browser = theBrowser;
            common.standardSetup(function() {
                event = common.server.db.events.at(0);
                event.start();
                session = event.get("sessions").at(0);
                done();
            });
        });
    });
    after(function(done) {
        browser.quit().then(function() {
            common.standardShutdown(done);
        });
    });

    it("Communicates the hangout's URL on connction.", function(done) {
        var u1 = common.server.db.users.at(0);
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate(u1.get("sock-key"));
        // At first, there's no hangout url..
        expect(session.get("hangout-url")).to.be(null);

        // but after we connect ...
        var url = "http://localhost:7777/test/hangout/" + session.id + "/";
        browser.get(url);
        browser.waitForFunc(function() {
            return session.getNumConnectedParticipants() == 1;
        }).then(function() {;
            expect(session.get("hangout-url")).to.eql(url);
        });
        browser.get("http://localhost:7777/").then(function() {
            expect(session.get("hangout-url")).to.be(null);
            done();
        });
    });

    it("Updates connected participants who don't load app.", function(done) {
        var u1 = common.server.db.users.at(0);
        var u2 = common.server.db.users.at(1);
        var u3 = common.server.db.users.at(2);
        var u4 = common.server.db.users.at(3);
        var url = "http://localhost:7777/test/hangout/" + session.id + "/";
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate(u1.get("sock-key"));
        // First, load the hangout without extra users.
        browser.get(url);
        // Wait for iframe to load. Would be cleaner to introspect, but.. ugh.
        browser.waitForFunc(function() {
            return session.getNumConnectedParticipants() == 1;
        }).then(function() {
            expect(session.getNumConnectedParticipants()).to.be(1);
        });
        // Next, load the hangout with u2 and u3 as non-app users
        browser.get("http://localhost:7777/test/hangout/" + session.id + "/?mockUserIds=" + [
            u1.id, u2.id, u3.id
        ].join(","))
        // Wait a longer time, for the cross-document message with participants to come through.
        browser.waitForFunc(function() {
            return session.getNumConnectedParticipants() == 3;
        }).then(function() {
            expect(_.pluck(session.get("connectedParticipants"), "id")).to.eql([
                u1.id, u2.id, u3.id
            ]);
            done();
        });
    });
});

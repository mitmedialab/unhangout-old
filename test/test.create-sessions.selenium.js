var expect = require('expect.js'),
    _ = require("underscore"),
    common = require('./common');

var browser = null,
    event = null;

describe("CREATE SESSIONS", function() {
    if (process.env.SKIP_SELENIUM_TESTS) {
        return;
    }
    this.timeout(40000); // Extra long timeout for selenium :(

    before(function(done) {
        common.getSeleniumBrowser(function (theBrowser) {
            browser = theBrowser;
            common.standardSetup(function() {
                event = common.server.db.events.findWhere({shortName: "writers-at-work"});
                done();
            });
        });
    });
    after(function(done) {
        browser.quit().then(function() {
            common.standardShutdown(done);
        });
    });

    it("Creates a permalink session", function(done) {
        var sess;
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("regular1");
        browser.get("http://localhost:7777/h/");
        browser.byCss("#permalink-title").sendKeys("This won't work");
        browser.byCss("#permalink-create-submit").click();
        browser.byCss(".help-block").getText().then(function(text) {
            expect(text.indexOf('this-won-t-work') > -1).to.be(true);
        });
        browser.byCss(".suggestion").click().then(function() {
            // Should now be on the unhangout admin page.
            sess = common.server.db.permalinkSessions.findWhere({
                isPermalinkSession: true,
                shortCode: "this-won-t-work"
            });
            expect(sess).to.not.be(undefined);
            expect(sess.get('title')).to.be('');
            expect(sess.get('description')).to.be('');
        });
        browser.byCss("#title").sendKeys("This Will Work");
        browser.byCss("#description").sendKeys("And so will this");
        browser.byCss("input[type=submit]").click().then(function() {
            expect(sess.get('title')).to.be("This Will Work");
            expect(sess.get('description')).to.be("And so will this");
            done();
        });
        // Not testing the session redirect link here; that's tested elsewhere.
    });

    it("Creates an event session", function(done) {
        // Start with no sessions.
        event.get("sessions").reset();
        event.start();
        browser.get("http://localhost:7777");
        browser.mockAuthenticate("superuser1");
        browser.get("http://localhost:7777/event/" + event.id)
        browser.waitForSelector(".admin-button");
        browser.byCss(".admin-button").click();
        browser.byCss("#show-create-session-modal").click();
        browser.waitForSelector("#session_name");
        browser.byCss("#session_name").sendKeys("My New Session");
        browser.waitForSelector("#create-session");
        browser.byCss("#create-session").click();
        browser.byCsss(".session h3").then(function(els) {
            expect(els.length).to.be(1);
            els[0].getText().then(function(text) {
                expect(text).to.eql("My New Session");
            });
            expect(event.get("sessions").length).to.be(1);
            expect(event.get("sessions").at(0).get("title")).to.eql("My New Session");
        });
        browser.byCss(".admin-button").click();
        browser.byCss("#open-sessions").click();
        browser.executeScript("return $('.icon-lock').is(':visible');").then(function(viz) {
            expect(viz).to.be(false);
            done();
        });
    });
});

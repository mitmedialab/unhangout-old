var expect = require('expect.js'),
    _ = require("underscore"),
    common = require('./common');

describe("PROPOSE SESSIONS", function() {
    var browser = null,
        event = null;

    if (process.env.SKIP_SELENIUM_TESTS) {
        return;
    }
    this.timeout(60000); // Extra long timeout for selenium :(

    before(function(done) {
        this.timeout(240000);
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

    it("Proposes an event session", function(done) {
        // Start with no sessions.
        event.get("sessions").reset();
        event.set("open", true);
        browser.mockAuthenticate("superuser1");
        browser.get(common.URL + "/event/" + event.id)
        browser.waitForEventReady(event, "superuser1");
        browser.byCss(".admin-button").click();
        browser.byCss("#participant-proposed-sessions-mode").click();
        browser.byCss("#btn-propose-session").click();
        browser.waitForSelector("#topic_title");
        browser.byCss("#topic_title").sendKeys("My New Topic");
        browser.waitForSelector("#propose");
        browser.byCss("#propose").click();
        browser.byCsss(".topic-title").then(function(els) {
            expect(els.length).to.be(1);
            expect(event.get("sessions").at(0).get("approved")).to.eql(false);
            els[0].getText().then(function(text) {
                expect(text).to.eql("My New Topic");
            });
            expect(event.get("sessions").length).to.be(1);
            expect(event.get("sessions").at(0).get("title")).to.eql("My New Topic");
            expect(event.get("sessions").at(0).get("votes")).to.eql(0);
        });

        // Topics disappear when admin only
        browser.byCss(".admin-button").click();
        browser.byCss("#admin-proposed-sessions-mode").click();
        browser.executeScript("return $('.topic-list').is(':visible');").then(function(viz) {
            expect(viz).to.be(false);
            done();
        });
    });

    it("Votes for a proposed topic", function(done) {
        event.set("open", true);
        event.set("adminProposedSessions", false);
        browser.mockAuthenticate("regular1");
        browser.get(common.URL + "/event/" + event.id);
        browser.waitForEventReady(event, "regular1");

        // HOW TO ACCESS BUTTON?
        // Can vote for topic just once
        // browser.waitForSelector(".btn-vote");
        // browser.byCss(".btn-vote").click();
        // browser.byCsss(".topic-title").then(function(els) {
        //     expect(event.get("sessions").length).to.be(1);
        //     expect(event.get("sessions").at(0).get("votes")).to.eql(1);
        // });

        // browser.byCss(".btn-vote").click();
        browser.byCsss(".topic-title").then(function(els) {
        //     expect(event.get("sessions").length).to.be(1);
        //     expect(event.get("sessions").at(0).get("votes")).to.eql(1);
            done();
        });
    });

    it("Updates a proposed topic", function(done) {
        event.set("open", true);
        event.set("adminProposedSessions", false);
        browser.mockAuthenticate("regular1");
        browser.get(common.URL + "/event/" + event.id);
        browser.waitForEventReady(event, "regular1");

        // Cannot edit topics submitted by others
        browser.executeScript("return $('.btn-edit-topic').is(':visible');").then(function(viz) {
            expect(viz).to.be(false);
        });

        // Can edit topics submitted by self
        browser.byCss("#btn-propose-session").click();
        browser.waitForSelector("#topic_title");
        browser.byCss("#topic_title").sendKeys("Another New Topic");
        browser.waitForSelector("#propose");
        browser.byCss("#propose").click();
        browser.executeScript("return $('.btn-edit-topic').is(':visible');").then(function(viz) {
            expect(viz).to.be(true);
        });
        browser.byCss(".btn-edit-topic").click();
        // NEED TO PRESS ENTER TO CHANGE TOPIC TITLE
        browser.byCss("#edit-topic").sendKeys("Changed Topic");
        browser.byCsss(".topic-title").then(function(els) {
            expect(els.length).to.be(1);
            els[0].getText().then(function(text) {
                // expect(text).to.eql("Changed Topic");
            });
            expect(event.get("sessions").length).to.be(2);
            // expect(event.get("sessions").at(1).get("title")).to.eql("Changed Topic");
            done();
        });
    });

    it("Approves a proposed topic", function(done) {
        // Start with no sessions.
        event.get("sessions").reset();
        event.set("open", true);
        event.set("adminProposedSessions", false);
        browser.mockAuthenticate("superuser1");
        browser.get(common.URL + "/event/" + event.id)
        browser.waitForEventReady(event, "superuser1");
        browser.byCss("#btn-propose-session").click();
        browser.waitForSelector("#topic_title");
        browser.byCss("#topic_title").sendKeys("My New Topic");
        browser.waitForSelector("#propose");
        browser.byCss("#propose").click();
        browser.byCsss(".topic-title").then(function(els) {
            expect(els.length).to.be(1);
            expect(event.get("sessions").at(0).get("approved")).to.eql(false);
            expect(event.get("sessions").length).to.be(1);
        });

        browser.byCss(".approve").click();
        browser.byCsss(".session-title").then(function(els) {
            expect(els.length).to.be(1);
            expect(event.get("sessions").at(0).get("approved")).to.eql(true);
            expect(event.get("sessions").length).to.be(1);
            done();
        });
    });
});

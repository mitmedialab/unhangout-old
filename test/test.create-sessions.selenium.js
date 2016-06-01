var expect = require('expect.js'),
    _ = require("underscore"),
    common = require('./common');

describe("CREATE SESSIONS", function() {
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

    it("Creates a permalink session", function(done) {
        var sess;
        browser.mockAuthenticate("regular1");
        browser.get(common.URL + "/h/");
        browser.waitForSelector("#permalink-title");
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
        browser.byCss("#session-update").click().then(function() {
            expect(sess.get('title')).to.be("This Will Work");
            expect(sess.get('description')).to.be("And so will this");
            done();
        });
        // Not testing the session redirect link here; that's tested elsewhere.
    });

    it("Creates an event session", function(done) {
        // Start with no sessions.
        event.get("sessions").reset();
        event.set("open", true);
        event.set("adminProposedSessions", true);

        browser.mockAuthenticate("superuser1");
        browser.get(common.URL + "/event/" + event.id) 
        browser.waitForEventReady(event, "superuser1"); 
        browser.byCss(".admin-button").click();    
        browser.waitForSelector('#choose-breakout-mode');
        browser.executeScript("$('#choose-breakout-mode').mouseover();");
        browser.byCss("#admin-proposed-sessions-mode").click();
        browser.byCss("#btn-create-session").click();

        browser.waitForSelector("#session_name");
        browser.byCss("#session_name").sendKeys("My New Session");
        browser.waitForSelector("#create-session");
        browser.byCss("#create-session").click();
        browser.byCsss(".session-title").then(function(els) {
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

    it("Creates an event session with youtube", function(done) {
        event.get("sessions").reset();
        event.set("open", true);
        event.set("adminProposedSessions", true);

        browser.mockAuthenticate("superuser1");
        browser.get(common.URL + "/event/" + event.id);
        browser.waitForEventReady(event, "superuser1");
        browser.waitForSelector(".admin-button");
        browser.byCss(".admin-button").click();
        browser.waitForSelector('#choose-breakout-mode');
        browser.executeScript("$('#choose-breakout-mode').mouseover();");
        browser.byCss("#admin-proposed-sessions-mode").click();
        browser.byCss("#btn-create-session").click();

        browser.waitForSelector("#session_name");
        browser.byCss("#session_name").sendKeys("Video Session");
        browser.byCss("input[value='video']").click();
        browser.waitForSelector("#session_youtube_id");
        browser.byCss("#session_youtube_id").sendKeys(
            "https://www.youtube.com/watch?v=jNQXAC9IVRw"
        );
        browser.byCss("#create-session").click();
        browser.byCsss(".session-title").then(function(els) {
            expect(els.length).to.be(1);
            expect(event.get("sessions").at(0).get("activities")).to.eql([{
                type: "video",
                video: {
                    provider: "youtube", id: "jNQXAC9IVRw"
                }
            }]);
            els[0].getText().then(function(text) {
                expect(text).to.eql("Video Session");
                done();
            });
        });
    });

    it("Creates an event session with joinCap", function(done) {
        event.get("sessions").reset();
        event.set("open", true);
        event.set("adminProposedSessions", true);

        browser.mockAuthenticate("superuser1");
        browser.get(common.URL + "/event/" + event.id);
        browser.waitForEventReady(event, "superuser1");
        browser.waitForSelector(".admin-button");
        browser.byCss(".admin-button").click();
        browser.waitForSelector('#choose-breakout-mode');
        browser.executeScript("$('#choose-breakout-mode').mouseover();");
        browser.byCss("#admin-proposed-sessions-mode").click();
        browser.byCss("#btn-create-session").click();
        browser.waitForSelector("#join_cap");

        // Error for NaN
        browser.waitForSelector("#session_name");
        browser.byCss("#session_name").sendKeys("Joining Capacity");
        browser.byCss("#join_cap").clear();
        browser.byCss("#join_cap").sendKeys("wat");
        browser.byCss("#join_cap").getAttribute("value").then(function(val) {
            //expect(val).to.be("wat"); // Recent firefox doesn't allow these chars on number input
            expect(val).to.be("");
        });
        browser.byCss("#create-session").click();
        browser.waitForSelector(".create-session-error");
        browser.executeScript("$('.create-session-error').hide();");

        // Error for too low
        browser.waitForSelector("#session_name");
        browser.byCss("#session_name").sendKeys("Joining Capacity");
        browser.byCss("#join_cap").clear();
        browser.byCss("#join_cap").sendKeys("1");
        browser.byCss("#create-session").click();
        browser.waitForSelector(".create-session-error");
        browser.executeScript("$('.create-session-error').hide();");

        // Error for too high
        browser.waitForSelector("#session_name");
        browser.byCss("#session_name").sendKeys("Joining Capacity");
        browser.byCss("#join_cap").clear();
        browser.byCss("#join_cap").sendKeys("11");
        browser.byCss("#create-session").click();
        browser.waitForSelector(".create-session-error");
        browser.executeScript("$('.create-session-error').hide();");

        // Goldilocks

        browser.waitForSelector("#session_name");
        browser.byCss("#session_name").sendKeys("Joining Capacity");
        browser.byCss("#join_cap").clear();
        browser.executeScript("$('#join_cap').val('');");
        browser.byCss("#join_cap").sendKeys("3");
        browser.byCss("#create-session").click();   

        browser.waitForSelector(".session .hangout-users");
        browser.byCsss(".session .hangout-users li").then(function(els) {
            expect(els.length).to.be(3);
            expect(event.get("sessions").at(0).get("joinCap")).to.be(3);
            done();
        });
    });
});

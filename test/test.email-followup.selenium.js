var expect = require('expect.js'),
    common = require('./common');

describe("SUPERUSER SENDS FOLLOWUP EMAILS (BROWSER)", function() {
    var browser = null;

    var longEnough = "This is a description that is long enough to meet the 100 char length validation for descriptions..."

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

    it("Is prompted to login when unauthenticated", function(done) {
        browser.get(common.URL);
        browser.byCss("#login-first-button").click();
        browser.waitForSelector("#login-first-modal h4");
        browser.byCss("#login-first-modal h4").getText().then(function(text) {
            expect(text).to.eql("Please log in!");
            done();
        });
    });

    it("Super User sends followup emails", function(done) {
        
        browser.mockAuthenticate("superuser1");
        // Admin goes to the event page.  Connect a socket to a session.
        //browser.get(common.URL + "/event/" + event.id)
        //browser.waitForEventReady(event, "superuser1");

    });
});

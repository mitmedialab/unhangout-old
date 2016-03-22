var should      = require('should'),
    common      = require('./common');

describe("FRONT PAGE", function() {
    var browser = null;

    if (process.env.SKIP_SELENIUM_TESTS) { return; }
    this.timeout(60000); // Extra long timeout for selenium :(

    before(function(done) {
        this.timeout(240000);
        common.stopSeleniumServer().then(function() {
          common.getSeleniumBrowser(function (theBrowser) {
              browser = theBrowser;
              common.standardSetup(done);
          });
        });
    });
    after(function(done) {
        browser.quit().then(function() {
            common.standardShutdown(done);
        });
    });

    var navLinkActive = function(href) {
        return function() {
          browser.waitForSelector("li.active a[href='" + href + "']");
        }
    };

    it("gets home page and nav links activate", function(done) {
        browser.get(common.URL);

        browser.byLinkText("About").click().then(navLinkActive("/about/"));
        browser.byLinkText("Events").click().then(navLinkActive("/events/"));
        // need to be logged in for /h/.
        browser.mockAuthenticate("regular1");
        browser.get(common.URL);
        browser.byLinkText("Permalinks").click().then(navLinkActive("/h/"));
        browser.unMockAuthenticate().then(function() {
            done();
        });
    });

    it("shows a static event page to unauthenticated users", function(done) {
        common.server.db.events.get(1).set({open: true});
        browser.get(common.URL + "/event/1");
        browser.waitForSelector(".event-static");
        browser.byLinkText("Login").click();
        browser.getCurrentUrl().then(function(url) {
            url.indexOf("https://accounts.google.com/").should.equal(0);
        });
        // Get the dynamic page after auth.
        browser.get(common.URL + "/event/1");
        browser.mockAuthenticate("regular1");
        browser.get(common.URL + "/event/1");
        browser.waitForSelector("#app").then(function() {
            common.server.db.events.get(1).set({open: false});
            done();
        });
    });
});


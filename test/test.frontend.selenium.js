var should      = require('should'),
    common      = require('./common');

describe("FRONT PAGE", function() {
    var browser = null;

    if (process.env.SKIP_SELENIUM_TESTS) { return; }
    this.timeout(60000); // Extra long timeout for selenium :(

    before(function(done) {
        common.getSeleniumBrowser(function (theBrowser) {
            browser = theBrowser;
            common.standardSetup(done);
        });
    });
    after(function(done) {
        browser.quit().then(function() {
            common.standardShutdown(done);
        });
    });

    var navLinkActive = function(href) {
        return function() {
            browser.waitWithTimeout(function() {
                return browser.byCsss("li a[href='" + href + "']").then(function(els) {
                    return els.length == 1;
                });
            });
        };
    };

    it("gets home page and nav links activate", function(done) {
        browser.get(common.URL);

        //Commenting this out as we are now using logo for the home page
        // browser.byCss("h1").getText().then(function(text) {
        //     text.should.equal("Unhangouts");
        // });
        browser.byLinkText("About").click().then(navLinkActive("/about/"));
        browser.byLinkText("Events").click().then(navLinkActive("/events/"));
        // browser.byLinkText("How to Unhangout").click().then(navLinkActive('/how-to-unhangout/'));
        // browser.byLinkText("Home").click().then(navLinkActive("/")).then(function() {
        //     done();
        // });
    });

    it("shows a static event page to unauthenticated users", function(done) {
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
            done();
        });
    });
});


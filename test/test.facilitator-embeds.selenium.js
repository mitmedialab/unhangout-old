var expect = require('expect.js'),
    _ = require("underscore"),
    common = require('./common');

describe("FACILITATOR EMBEDS", function() {
    var browser = null,
        event = null;

    if (process.env.SKIP_SELENIUM_TESTS) {
        return;
    }
    this.timeout(60000); // Extra long timeout for selenium :(

    before(function(done) {
        common.getSeleniumBrowser(function (theBrowser) {
            browser = theBrowser;
            common.standardSetup(function() {
                event = common.server.db.events.findWhere({shortName: "writers-at-work"});
                event.set("open", true);
                done();
            });
        });
    });

    after(function(done) {
        browser.quit().then(function() {
            common.standardShutdown(done);
        });
    });

    it("Gets an about page with auto-hide for new sessions", function(done) {
        var session = event.get("sessions").at(0);
        browser.get(common.URL)
        browser.mockAuthenticate("regular1");
        browser.get(common.URL + "/facilitator/" + session.id + "/");
        browser.waitForSelector(".cancel-autohide");
        browser.waitForScript("$");
        browser.executeScript(
            "return $('.main-window').hasClass('sidebar');"
        ).then(function(val) {
            expect(val).to.be(true);
            done();
        });
    });
    it("Displays, removes, and changes embedded webpages", function(done) {
        var session = event.get("sessions").at(0);
        browser.get(common.URL)
        browser.mockAuthenticate("regular1");

        // Load a session page with a webpage activity.
        session.set("activities", [{type: "webpage", url: common.URL + "/public/html/test.html"}]);
        browser.get(common.URL + "/facilitator/" + session.id + "/");
        // Ensure the webpage is displayed.
        browser.waitForScript("$");
        browser.executeScript("return $('iframe').attr('src');").then(function(src) {
            expect(src).to.eql(common.URL + "/public/html/test.html");

        });
 
        // Remove the embed.
        browser.byCss(".activity-settings").click();
        browser.waitForSelector(".remove-embed");
        browser.byCss(".remove-embed").click();

        // Ensure 'about' is displayed.
        browser.waitForSelector(".about-activity");
        browser.waitForScript("$");
        browser.executeScript("return $('.about-activity').text();").then(function(text) {
            expect(text.indexOf("helps the Unhangout Permalink service")).to.not.eql(-1);
            expect(session.get("activities")).to.eql([{'type': 'about'}]);
        });
        
        // Ensure modals have been removed and not just hidden.
        browser.wait(function() {
          return browser.byCsss(".add-activity-dialog").then(function(els) {
            return els.length === 0;
          });
        });

        // Add a new activity.
        browser.byCss(".add-activity").click();
        browser.waitForSelector(".add-activity-dialog input[type='text']");
        // Doesn't allow blank URL's.
        browser.byCss(".add-activity-dialog input[type='text']").sendKeys("   ");
        browser.byCss(".add-activity-dialog [type='submit']").click();
        // Nothing should happen... the next call should fail if the modal is closed.

        // Allows non-blank URLs.
        browser.byCss(".add-activity-dialog input[type='text']").sendKeys(common.URL + "/public/html/test.html");
        browser.byCss(".add-activity-dialog [type='submit']").click();
        browser.waitForSelector("iframe");
        browser.byCss(".webpage-activity"); // throws error if it's not there
        browser.waitForScript("$");
        browser.executeScript("return $('iframe').attr('src');").then(function(src) {
            expect(src).to.eql(common.URL + "/public/html/test.html");
            expect(session.get("activities")).to.eql([{
                'type': 'webpage', 'url': common.URL + "/public/html/test.html"
            }]);
        });
        // Embeds youtube videos.
        browser.byCss(".activity-settings").click();
        // Can't seem to get around this hard-coded delay; get occasional
        // "Element is no longer attached to the DOM" errors without it.
        browser.waitTime(1000);
        browser.waitForSelector(".add-activity-dialog input[type='text']");
        browser.byCss(".add-activity-dialog input[type='text']").sendKeys(
            "https://youtu.be/NIylUcGDi-Y")
        browser.byCss(".add-activity-dialog [type='submit']").click();
        browser.waitForSelector("iframe");
        browser.waitForScript("$");
        browser.executeScript("return $('iframe').attr('src');").then(function(src) {
            expect(src).to.eql("https://www.youtube.com/embed/NIylUcGDi-Y?wmode=transparent&enablejsapi=1&origin=" + encodeURIComponent(common.URL))
            expect(session.get("activities")).to.eql([{
                'type': 'video', 'video': {'provider': "youtube", 'id': 'NIylUcGDi-Y'}
            }]);
            done();
        });
        // Punting on testing youtube transport stuff for now..
    });
});

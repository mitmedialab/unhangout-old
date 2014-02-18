var expect = require('expect.js'),
    _ = require("underscore"),
    common = require('./common');

var browser = null,
    event = null;

describe("FACILITATOR EMBEDS", function() {
    if (process.env.SKIP_SELENIUM_TESTS) {
        return;
    }
    this.timeout(40000); // Extra long timeout for selenium :(

    before(function(done) {
        common.getSeleniumBrowser(function (theBrowser) {
            browser = theBrowser;
            common.standardSetup(function() {
                event = common.server.db.events.findWhere({shortName: "writers-at-work"});
                event.start();
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
        browser.get("http://localhost:7777/")
        browser.mockAuthenticate("regular1");
        browser.get("http://localhost:7777/facilitator/" + session.id + "/");
        browser.waitForSelector(".cancel-autohide");
        browser.executeScript(
            "return $('.main-window').hasClass('sidebar');"
        ).then(function(val) {
            expect(val).to.be(true);
            done();
        });
    });
    it("Displays, removes, and changes embedded webpages", function(done) {
        var session = event.get("sessions").at(0);
        browser.get("http://localhost:7777/")
        browser.mockAuthenticate("regular1");
        
        // Load a session page with a webpage activity.
        session.set("activities", [{type: "webpage", url: "http://localhost:7777/public/html/test.html"}]);
        browser.get("http://localhost:7777/facilitator/" + session.id + "/");
        // Ensure the webpage is displayed.
        browser.executeScript("return $('iframe').attr('src');").then(function(src) {
            expect(src).to.eql("http://localhost:7777/public/html/test.html");

        });
        // Remove the embed.
        browser.byCss(".activity-settings").click();
        browser.waitForSelector(".remove-embed");
        browser.byCss(".remove-embed").click();
        // Ensure 'about' is displayed.
        browser.waitForSelector(".about-activity");
        browser.executeScript("return $('.about-activity').text();").then(function(text) {
            expect(text.indexOf("helps the Unhangout Permalink service")).to.not.eql(-1);
            expect(session.get("activities")).to.eql([{'type': 'about'}]);
        });
        // Add a new activity.
        browser.byCss(".add-activity").click();
        browser.waitForSelector(".modal-body input[type='text']");
        // Doesn't allow blank URL's.
        browser.byCss(".modal-body input[type='text']").sendKeys("   ");
        browser.byCss(".modal input[type='submit']").click();
        // Nothing should happen... the next call should fail if the modal is closed.
        
        // Allows non-blank URLs.
        browser.byCss(".modal-body input[type='text']").sendKeys("http://localhost:7777/public/html/test.html");
        browser.byCss(".modal input[type='submit']").click();
        browser.waitForSelector("iframe");
        browser.byCss(".webpage-activity"); // throws error if it's not there
        browser.executeScript("return $('iframe').attr('src');").then(function(src) {
            expect(src).to.eql("http://localhost:7777/public/html/test.html");
            expect(session.get("activities")).to.eql([{
                'type': 'webpage', 'url': "http://localhost:7777/public/html/test.html"
            }]);
        });
        // Embeds youtube videos.
        browser.byCss(".activity-settings").click();
        browser.waitForSelector(".modal-body input[type='text']");
        browser.byCss(".modal-body input[type='text']").sendKeys(
            "https://youtu.be/NIylUcGDi-Y")
        browser.byCss(".modal input[type='submit']").click();
        browser.waitForSelector("iframe");
        browser.executeScript("return $('iframe').attr('src');").then(function(src) {
            expect(src).to.eql("https://www.youtube.com/embed/NIylUcGDi-Y?wmode=transparent&enablejsapi=1&origin=http%3A%2F%2Flocalhost%3A7777")
            expect(session.get("activities")).to.eql([{
                'type': 'video', 'video': {'provider': "youtube", 'id': 'NIylUcGDi-Y'}
            }]);
            done();
        });
        // Punting on testing youtube transport stuff for now..
    });
});

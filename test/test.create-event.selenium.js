var should      = require('should'),
    common      = require('./common');

var browser = null;

describe("CREATE EVENT", function() {
    if (process.env.SKIP_SELENIUM_TESTS) { return; }
    this.timeout(40000); // Extra long timeout for selenium :(

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

    it("Creates an event via admin page", function(done) {
        // Authenticate
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("superuser1");

        // Create a new event.
        browser.get("http://localhost:7777/admin/");
        browser.byLinkText("new").click();
        browser.waitForSelector("[name='title']");
        browser.byCss("[name='title']").sendKeys("Test Title");
        browser.byCss("[name='shortName']").sendKeys("test-title");
        browser.byCss("[name='organizer']").sendKeys("unhangoutdev@gmail.com");
        browser.byCss("[name='welcomeMessage']").sendKeys("<em>Welcome!</em>");
        // richtext editor control.
        browser.waitForSelector(".note-editable");
        browser.byCss(".note-editable").sendKeys("This is my description");
        browser.byCss(".btn-primary.create-event").click()
        var eventId;
        browser.getCurrentUrl().then(function(url) {
            var match = /^http:\/\/localhost:7777\/event\/(\d+)$/.exec(url);
            (match == null).should.equal(false);
            eventId = match[1];
        }).then(function() {
            browser.get("http://localhost:7777/admin/")
            browser.byCss("#events a[href='/event/" + eventId + "']").getText().then(
                function(text) {
                    text.should.equal("Test Title (test-title)");
                });
            
            // Event hasn't started
            browser.get("http://localhost:7777/event/" + eventId)
            browser.getTitle().then(function(title) {
                title.should.equal("Test Title — powered by unhangout");
            });
            browser.waitForSelector("#about-event h1");
            browser.byCss("#about-event h1").getText().then(function(text) {
                text.should.equal("Test Title");
            });
            browser.byCss("#about-event h4").getText().then(function(text) {
                text.should.equal("hosted by unhangoutdev@gmail.com");
            });
            browser.byCss("#about-event .footer").getText().then(function(text) {
                text.indexOf("has not yet started").should.not.equal(-1);
            });

            // Start the event.
            browser.get("http://localhost:7777/admin");
            browser.byCsss(".admin-table-buttons .btn-success").then(function(els) {
                // TODO This is a little hackish -- should have a cleaner way to
                // select the event. Goes along with the un-hard-code event ID.
                els[2].click();
            });

            // View the started event
            browser.get("http://localhost:7777/event/" + eventId);
            // Expose the 'about' div
            browser.byCss("#about-nav a").click();
            browser.executeScript("return $('#about-event .footer').is(':visible');").then(function(res) {
                // No longer have footer message.
                res.should.equal(false);
            });
            // Hide the 'about' div
            browser.byCss("#about-nav a").click();
            browser.byCss("#session-list").getText().then(function(text) {
                text.indexOf("Sessions will appear here").should.not.equal(-1);
                done();
            });
        });
    });
});


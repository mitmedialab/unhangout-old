var should      = require('should'),
    common      = require('./common');

var browser = null;

describe("CREATE EVENT", function() {
    if (process.env.SKIP_SELENIUM_TESTS) { return; }
    this.timeout(40000); // Extra long timeout for selenium :(

    before(function(done) {
        common.getSeleniumBrowser(function (theBrowser) {
            browser = theBrowser;
            common.mockSetup(true)(done);
        });
    });
    after(function(done) {
        browser.quit().then(function() { 
            common.standardShutdown(done);
        });
    });

    it("Creates an event via admin page", function(done) {
        // Create a new event.
        browser.get("http://localhost:7777/admin");
        browser.byLinkText("new").click();
        browser.byCss("[name='title']").sendKeys("Test Title");
        browser.byCss("[name='shortName']").sendKeys("test-title");
        browser.byCss("[name='organizer']").sendKeys("unhangoutdev@gmail.com");
        browser.byCss("[name='description']").sendKeys("This is my description");
        browser.byCss("[name='welcomeMessage']").sendKeys("<em>Welcome!</em>");
        browser.byCss(".btn-primary").click()
        browser.byCss("#events a[href='/event/2']").then(function(el) {
            el.getText().then(function(text) {
                text.should.equal("Test Title (test-title)");
            });
        })
        
        // Event hasn't started
        browser.get("http://localhost:7777/event/2")
        browser.getTitle().then(function(title) {
            title.should.equal("Test Title — powered by unhangout");
        });
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
            // This is a little hackish -- should have a cleaner way to select the event.
            els[1].click();
        })

        // View the started event
        browser.get("http://localhost:7777/event/2");
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


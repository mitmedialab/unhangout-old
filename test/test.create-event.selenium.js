var expect      = require('expect.js'),
    common      = require('./common'),
    moment      = require('moment');

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
        browser.byCss("[name='welcomeMessage']").sendKeys("Welcome!");
        browser.byCss("[name='description']").sendKeys("<b>Fun event!</b>");
        
        /* Disabled until we can figure out sanitization issues.
        // richtext editor control.
        browser.waitForSelector(".note-editable");
        browser.byCss(".note-editable").sendKeys("This is my description");
        */

        browser.byCss(".btn-primary.create-event").click()
        var eventId;
        browser.getCurrentUrl().then(function(url) {
            var match = /^http:\/\/localhost:7777\/event\/(\d+)$/.exec(url);
            expect(match == null).to.be(false);
            eventId = match[1];
        }).then(function() {
            browser.get("http://localhost:7777/admin/")
            browser.byCss("#events a[href='/event/" + eventId + "']").getText().then(
                function(text) {
                    expect(text).to.be("Test Title (test-title)");
                });
            
            // Event hasn't started
            browser.get("http://localhost:7777/event/" + eventId)
            browser.getTitle().then(function(title) {
                expect(title).to.be("Test Title — powered by unhangout");
            });
            browser.waitForSelector("#about-event h1");
            browser.byCss("#about-event h1").getText().then(function(text) {
                expect(text).to.be("Test Title");
            });
            browser.byCss("#about-event h4").getText().then(function(text) {
                expect(text).to.be("hosted by unhangoutdev@gmail.com");
            });
            browser.byCss("#about-event .footer").getText().then(function(text) {
                expect(text.indexOf("has not yet started")).to.not.eql(-1);
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
                expect(res).to.be(false);
            });
            // Hide the 'about' div
            browser.byCss("#about-nav a").click();
            browser.byCss("#session-list").getText().then(function(text) {
                expect(text.indexOf("Sessions will appear here")).to.not.eql(-1);
                done();
            });


            // Edit the event
            browser.byCss(".admin-button").click();
            browser.waitForSelector("#admin-page-for-event");
            browser.byCss("#admin-page-for-event").click();
            // Ensure event stuff is there
            browser.executeScript("return {" +
                                  " title: $('#inputTitle').val(), " +
                                  " organizer: $('#inputOrganizer').val(), " +
                                  " shortName: $('#inputShortName').val(), " +
                                  " dateAndTime: $('#dateAndTime').val(), " +
                                  " timeZoneValue: $('#timeZoneValue').val(), " +
                                  " welcomeMessage: $('#inputWelcomeMessage').val(), " +
                                  " description: $('[name=description]').val()};")
            .then(function(attrs) {
                var event = common.server.db.events.get(eventId);
                var att = event.attributes;
                expect(attrs).to.eql({
                    title: att.title,
                    organizer: att.organizer,
                    shortName: att.shortName, 
                    dateAndTime: att.dateAndTime,
                    timeZoneValue: att.timeZoneValue,
                    welcomeMessage: att.welcomeMessage,
                    description: att.description
                });
            });
        });
    });
});


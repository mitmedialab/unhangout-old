var expect      = require('expect.js'),
    common      = require('./common'),
    moment      = require('moment'),
    request     = require("superagent"),
    Promise     = require("bluebird");

describe("CREATE EVENT", function() {
    if (process.env.SKIP_SELENIUM_TESTS) { return; }
    this.timeout(60000); // Extra long timeout for selenium :(

    var browser = null;
    var aboutIsVisible = function(isVisible) {
        var query = (isVisible ? "" : "!") + '$("#about-event").is(":visible")';
        return browser.waitWithTimeout(function() {
            return browser.executeScript("return " + query + ";");
        });
    }
    var chatIsEnabled = function(isEnabled) {
        var query = '$("#chat-input").attr("disabled") === ' + (
            isEnabled ? "undefined" : '"disabled"'
        );
        return browser.waitWithTimeout(function() {
            return browser.executeScript("return " + query + ";");
        });
    }

    before(function(done) {
        this.timeout(120000);
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
        browser.get(common.URL);
        browser.mockAuthenticate("superuser1");

        // Create a new event.
        browser.get(common.URL + "/admin/");
        browser.waitForSelector("a#admin-create-new-event");
        browser.byCss("a#admin-create-new-event").click();
       // browser.byLinkText("new").click();
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
            expect(url).to.be(common.URL + "/event/test-title");
            eventId = common.server.db.events.findWhere({shortName: "test-title"}).id
        }).then(function() {
            var event = common.server.db.events.get(eventId);
            browser.get(common.URL + "/admin/")
            browser.byCss("#events a[href='/event/" + eventId + "']").getText().then(
                function(text) {
                    expect(text).to.be("Test Title");
                }
            );

            // Event hasn't started
            browser.get(common.URL + "/event/" + eventId)
            browser.waitForEventReady(event, "superuser1");
            browser.getTitle().then(function(title) {
                expect(title).to.be("Test Title — powered by unhangout");
            });
            browser.waitForSelector("#about-event h2");
            browser.byCss("#about-event h2").getText().then(function(text) {
                expect(text).to.be("Test Title");
            });
            browser.byCss("#about-event h3").getText().then(function(text) {
                expect(text).to.be("hosted by unhangoutdev@gmail.com");
            });
            
            chatIsEnabled(false);

            // Start the event.
            browser.get(common.URL + "/admin");
            browser.byCss(".start-event[data-event='" + eventId + "']").click();

            // View the started event
            browser.get(common.URL + "/event/" + eventId);
            browser.waitForEventReady(event, "superuser1");
            chatIsEnabled(true);

            // Show the 'about' pane.
            browser.byCss("#about-nav a").click();
            aboutIsVisible(true);

            browser.executeScript(
                "return $('#about-event .event-status-footer').is(':visible');"
            ).then(function(res) {
                expect(res).to.be(false);
            });

            // Hide the 'about' div
            browser.byCss("#about-nav a").click();
            aboutIsVisible(false);
            browser.byCss("#session-list").getText().then(function(text) {
                expect(text.indexOf("Sessions will appear here")).to.not.eql(-1);
            });
            // Show about again, then hide via scroll-up button.
            browser.byCss("#about-nav a").click();
            aboutIsVisible(true);

            // Edit the event
            browser.byCss(".admin-button").click();
            browser.waitForSelector("#admin-page-for-event");
            browser.byCss("#admin-page-for-event").click();
            browser.waitForSelector("option[value='Europe/Zurich']");
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
                    dateAndTime: moment(att.dateAndTime).format(event.DATE_DISPLAY_FORMAT),
                    timeZoneValue: att.timeZoneValue,
                    welcomeMessage: att.welcomeMessage,
                    description: att.description
                });
                done();
            });
        });
    });

    it("Hides the 'about' pane on event start", function(done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        event.set("open", false);

        var startStop = function(action) {
            var url = common.URL + "/admin/event/" + event.id + "/" + action;
            browser.then(function() {
                return new Promise(function(resolve, reject) {
                    request.post(url)
                        .set("x-mock-user", "superuser1")
                        .set("X-Requested-With", "XMLHttpRequest")
                        .redirects(0)
                        .end(function(res) {
                            if (res.status === 200) {
                                resolve();
                            } else {
                                reject("Unexpected status " + res.status);
                            }
                        });
                });
            });
        }

        browser.get(common.URL);
        browser.mockAuthenticate("regular1");
        browser.get(common.URL + event.getEventUrl());
        browser.waitForEventReady(event, "regular1");
        aboutIsVisible(true);
        chatIsEnabled(false);
        startStop("start");
        aboutIsVisible(false);
        chatIsEnabled(true);
        startStop("stop");
        aboutIsVisible(true);
        chatIsEnabled(false);
        browser.then(function() { done(); });
    });
});


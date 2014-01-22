var expect = require('expect.js'),
    _ = require("underscore"),
    common = require('./common');

var browser = null,
    event = null;

describe("EVENT SESSION MESSAGES", function() {
    if (process.env.SKIP_SELENIUM_TESTS) {
        return;
    }
    this.timeout(40000); // Extra long timeout for selenium :(

    before(function(done) {
        common.getSeleniumBrowser(function (theBrowser) {
            browser = theBrowser;
            common.standardSetup(function() {
                event = common.server.db.events.at(0);
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

    it("Admin sends a message to sessions.", function(done) {
        // Test that an admin sending a message via the "Send message to
        // sessions" successfully generates a socket message in one of the
        // event's session rooms.
        var sock;
        var session = event.get("sessions").at(0);
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("superuser1");
        // Admin goes to the event page.  Connect a socket to a session.
        browser.get("http://localhost:7777/event/" + event.id).then(function() {
            common.authedSock("regular2", session.getRoomId(), function(theSock) {
                sock = theSock;
                function onData(data) {
                    var message = JSON.parse(data);
                    expect(message.type).to.be("session/event-message"); 
                    expect(message.args).to.eql({
                        sender: "Superuser1 Mock",
                        message: "##unhangouts## Superuser1 Mock: This is fun!",
                    });
                    sock.removeListener("data", onData);
                    sock.close();
                    done();
                }
                sock.on("data", onData);
            });
        });
        // Wait for the user to show up as a participant.
        browser.waitForSelector("#session-list-container .session[data-session-id='"
                                + session.id + "'] li i.icon-user");
        // Send the message... sock's on("data, ...) handler will pick it up
        // and finish the test once we do.
        browser.byCss(".admin-button").click();
        browser.waitForSelector("#message-sessions");
        browser.byCss("#message-sessions").click();
        browser.waitForSelector("textarea#session_message");
        browser.byCss("textarea#session_message").sendKeys("This is fun!");
        browser.byCss("#send-session-message").click();
    });

    it("Sessions display message sent by admin, app hidden", function(done) {
        // Test that a message sent by admin to the session generates a hangout
        // notice when the app is not visible.
        
        var sock;
        var session = event.get("sessions").at(0);

        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("regular1");
        browser.get("http://localhost:7777/test/hangout/" + session.id + "/");
        browser.waitForSelector("iframe[name='gadget_frame']");
        browser.switchTo().frame("gadget_frame");

        // Generate an event message.
        browser.then(function() {
            common.authedSock("superuser1", event.getRoomId(), function(theSock) {
                sock = theSock;
                sock.write(JSON.stringify({
                    type: "broadcast-message-to-sessions",
                    args: {
                        roomId: event.getRoomId(),
                        message: "##unhangouts## Superuser1 Mock: Hey there session",
                    }
                }));
            });
        });

        browser.waitForSelector("#mock-hangout-notice p");
        browser.byCss("#mock-hangout-notice p").getText().then(function(text) {
            expect(text).to.eql("##unhangouts## Superuser1 Mock: Hey there session");
            done();
        });
    });

    it("Adds event url to message", function(done) {
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("superuser1");
        browser.get("http://localhost:7777/event/" + event.id);
        browser.byCss(".admin-button").click();
        browser.waitForSelector("#message-sessions");
        browser.byCss("#message-sessions").click();
        browser.waitForSelector("textarea#session_message");
        browser.byCss("textarea#session_message").sendKeys("This is fun!");
        browser.byCss(".add-url-to-message").click();
        browser.byCss("textarea#session_message").getAttribute("value").then(function(text) {
            expect(text).to.eql("This is fun!\n Copy and paste: http://localhost:7777/event/" + event.id);
            done();

        });

    });
});

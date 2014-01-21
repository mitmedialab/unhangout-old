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
                        message: "This is fun!",
                        insistent: false
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

    it("Sessions display message sent by admin, app visible", function(done) {
        // Test that a message sent by admin to the session generates a dialog
        // when the app is visible.

        var sock;
        var session = event.get('sessions').at(0);

        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("regular1");
        browser.get("http://localhost:7777/test/hangout/" + session.id + "/");
        browser.waitForSelector("iframe[name='gadget_frame']");
        browser.switchTo().frame("gadget_frame");
        browser.waitForSelector("iframe[name='facilitator_frame']");
        browser.switchTo().frame("facilitator_frame");

            
        // Generate a session message.
        browser.then(function() {
            common.authedSock("superuser1", event.getRoomId(), function(theSock) {
                sock = theSock;
                sock.write(JSON.stringify({
                    type: "broadcast-message-to-sessions",
                    args: {
                        roomId: event.getRoomId(),
                        message: "Hey there session",
                        insistent: false
                    }
                }));
                sock.close();
            });
        });

        browser.waitForSelector(".event-message-window h3")
        browser.byCss(".event-message-window h3").getText().then(function(text) {
            expect(text).to.eql("Message from Superuser1 Mock");
        });
        browser.byCss(".event-message-window .modal-body").getText().then(function(text) {
            expect(text).to.eql("Superuser1 Mock: Hey there session");
            done();
        });
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
        browser.waitForSelector("iframe[name='facilitator_frame']");
        browser.switchTo().frame("facilitator_frame");

        // "Hide" the app.
        browser.byCss(".hide-app").click();
        browser.switchTo().alert().accept();
        browser.switchTo().defaultContent();
        browser.switchTo().frame("gadget_frame");

        // Generate an event message.
        browser.then(function() {
            common.authedSock("superuser1", event.getRoomId(), function(theSock) {
                sock = theSock;
                sock.write(JSON.stringify({
                    type: "broadcast-message-to-sessions",
                    args: {
                        roomId: event.getRoomId(),
                        message: "Hey there session",
                        insistent: false
                    }
                }));
            });
        });

        browser.waitForSelector("#mock-hangout-notice p");
        browser.byCss("#mock-hangout-notice p").getText().then(function(text) {
            expect(text).to.eql("Superuser1 Mock: Hey there session");
            done();
        });
    });

    it("Displays un-dismiss-able modals, app visible", function(done) {
        var sock;
        var session = event.get("sessions").at(0);

        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("regular1");
        browser.get("http://localhost:7777/test/hangout/" + session.id + "/");
        browser.waitForSelector("iframe[name='gadget_frame']");
        browser.switchTo().frame("gadget_frame");
        browser.waitForSelector("iframe[name='facilitator_frame']");
        browser.switchTo().frame("facilitator_frame");
        
        // Generate an event message.
        browser.then(function() {
            common.authedSock("superuser1", event.getRoomId(), function(theSock) {
                sock = theSock;
                sock.write(JSON.stringify({
                    type: "broadcast-message-to-sessions",
                    args: {
                        roomId: event.getRoomId(),
                        message: "Hey there session",
                        insistent: true
                    }
                }));
            });
        });

        browser.waitForSelector(".event-message-window h3")
        // message is there.
        browser.byCss(".event-message-window .modal-body").getText().then(function(text) {
            expect(text).to.eql("Superuser1 Mock: Hey there session");
        });
        // No 'click to close' thing.
        browser.byCsss(".event-message-window [data-dismiss='modal']").then(function(els) {
            expect(els.length).to.be(0);
        });
        // Clicking the backdrop doesn't dismiss.
        browser.byCss(".modal-backdrop").click();
        browser.byCss(".event-message-window h3"); // still visible

        browser.then(function() { done(); });
    });

    it("Displays un-dismiss-able modals, app hidden", function(done) {
        var sock;
        var session = event.get("sessions").at(0);

        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("regular1");
        browser.get("http://localhost:7777/test/hangout/" + session.id + "/");
        browser.waitForSelector("iframe[name='gadget_frame']");
        browser.switchTo().frame("gadget_frame");
        browser.waitForSelector("iframe[name='facilitator_frame']");
        browser.switchTo().frame("facilitator_frame");
        
        // "Hide" the app.
        browser.byCss(".hide-app").click();
        browser.switchTo().alert().accept();
        browser.switchTo().defaultContent();
        browser.switchTo().frame("gadget_frame");
        
        // Generate an event message.
        browser.then(function() {
            common.authedSock("superuser1", event.getRoomId(), function(theSock) {
                sock = theSock;
                sock.write(JSON.stringify({
                    type: "broadcast-message-to-sessions",
                    args: {
                        roomId: event.getRoomId(),
                        message: "Hey there session",
                        insistent: true
                    }
                }));
                sock.close();
            });
        });

        browser.waitForSelector("#mock-hangout-notice p");
        browser.byCss("#mock-hangout-notice p").getText().then(function(text) {
            expect(text).to.eql("Superuser1 Mock: Hey there session");
        });
        // you can dismiss it...
        browser.byCss("#mock-hangout-notice .dismiss-notice").click();
        var noticeDisplay = "return document.getElementById('mock-hangout-notice').style.display";
        browser.executeScript(noticeDisplay).then(function(display) {
            expect(display).to.eql("none");
        });
        // ... but it comes back eventually.
        browser.wait(function() {
            return browser.executeScript(noticeDisplay).then(function(display) {
                return display == "block";
            });
        });
        browser.then(function() {
            done();
        });
    });
});

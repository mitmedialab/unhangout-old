var expect = require('expect.js'),
    _ = require("underscore"),
    common = require('./common');

var browser = null,
    event = null;

describe("SESSION JOINING PARTICIPANT LISTS", function() {
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

    it("Updates session participant list when not present in the event", function(done) {
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("regular1");
        browser.get("http://localhost:7777/event/" + event.id);
        browser.byCsss("#presence-gutter .user").then(function(els) {
            expect(els.length).to.be(1);
        });
        var session = event.get("sessions").at(0);
        expect(session).to.not.be(undefined);
        var sock;
        var participantList = "#session-list-container .session[data-session-id='" + session.id + "'] li";
        var ready = false;
        // We should have an empty session participant list.
        browser.byCsss(participantList).then(function(els) {
            expect(els.length).to.be(10);
            _.each(els, function(el) {
                el.getText().then(function(text) {
                    expect(text).to.eql("");
                });
            });
        }).then(function() {
            // But then we connect a socket directly to the session.
            common.authedSock("regular2", session.getRoomId(), function(theSock) {
                sock = theSock;
                sock.on("data", function(message) { console.log(message); });
            });
        });
        // Now we should have a user show up in the participant list.
        browser.waitForSelector(participantList + " i.icon-user").then(function() {
            expect(session.getNumConnectedParticipants()).to.be(1);
            expect(session.get('hangoutConnected')).to.be(true);
            sock.close();
        });
        // The participant list should clear when the socket closes.
        browser.wait(function() {
            return browser.byCsss(participantList + " i.icon-user").then(function(els) {
                return els.length == 0;
            });
        }).then(function() {
            expect(session.getNumConnectedParticipants()).to.be(0);
            expect(session.get('hangoutConnected')).to.be(false);
            done();
        });
    });
    it("Updates session participant list when present in the event", function(done) {
        var sock1, sock2;
        var session = event.get("sessions").at(0);
        var participantList = "#session-list-container .session[data-session-id='" + session.id + "'] li";
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("regular1");
        // Connect the browser to the event page, then connect a socket
        // belonging to the same user to both event and session rooms.
        browser.get("http://localhost:7777/event/" + event.id).then(function() {
            common.authedSock("regular2", event.getRoomId(), function(sock) {
                sock1 = sock;
                common.authedSock("regular2", session.getRoomId(), function(sock) {
                    sock2 = sock;
                });
            });
        });
        // Two sockets should show up on the event page -- the browser, and the
        // bare socket.
        browser.byCsss("#presence-gutter .user").then(function(els) {
            expect(els.length).to.be(2);
        });
        // One socket should show up in the participant list.
        browser.waitForSelector(participantList + " i.icon-user").then(function() {
            sock1.close();
        });
        // Have the socket leave the event page, but not the participant list.
        browser.wait(function() {
            return browser.byCsss("#presence-gutter .user").then(function(els) {
                return els.length == 1;
            });
        });
        // Should still be in the participant list.
        browser.byCsss(participantList + " i.icon-user").then(function(els) {
            expect(els.length).to.be(1);
            expect(session.getNumConnectedParticipants()).to.be(1);
            expect(session.get('hangoutConnected')).to.be(true);
        }).then(function() {
            // Leave!
            sock2.close();
        });
        // Now noone should be left
        browser.wait(function() {
            return browser.byCsss(participantList + " i.icon-user").then(function(els) {
                return els.length == 0;
            });
        }).then(function() {;
            expect(session.getNumConnectedParticipants()).to.be(0);
            expect(session.get('hangoutConnected')).to.be(false);
            done();
        });
    });

    function disconnectionModalShowing(isShowing) {
        return browser.wait(function() {
            return browser.executeScript(
                "return $('#disconnected-modal').is(':visible')"
            ).then(function(result) {
                return result == isShowing;
            });
        });
    }

    it("Auto-reconnects event sockets on server restart", function(done) {
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("regular1");
        var sock;

        // Connect the browser and a socket to the event page.
        browser.get("http://localhost:7777/event/" + event.id).then(function() {
            common.authedSock("regular2", event.getRoomId(), function(thesock) {
                sock = thesock;
            });
        });
        browser.wait(function() {
            return browser.byCsss("#presence-gutter .user").then(function(els) {
                return els.length == 2;
            });
        }).then(function() {
            expect(event.get("connectedUsers").length).to.be(2);
            // Now restart the server...
            common.restartServer(function onStopped(restart) {
                // The browser should get a dialog warning us that disconnection happened.
                disconnectionModalShowing(true).then(function() {
                    restart();
                });
            }, function onRestarted() {
                // When the server restarts, the browser should auto
                // re-connect.  The bare socket, on the other hand, shouldn't,
                // as it didn't fire reconnection. So we expect to see only one
                // user now -- simulating what should happen if someone goes
                // away during server down time.
                disconnectionModalShowing(false);
                browser.byCsss("#presence-gutter .user").then(function(els) {
                    expect(els.length).to.be(1);
                    // Refresh the event now that we've re-populated it.
                    event = common.server.db.events.get(event.id)
                    expect(event.get("connectedUsers").length).to.be(1);
                    done();
                });
            });
        });
      
    });
    function framedDisconnectionModalShowing(isShowing) {
        return browser.wait(function() {
            return browser.executeScript(
                // Three frames deep. [[INCEPTION]]
                "return !!(" +
                    "document.getElementsByTagName('iframe')[0].contentWindow" +
                    ".document.getElementsByTagName('iframe')[0].contentWindow" +
                    ".document.getElementById('disconnected-modal')" +
                ");"
            ).then(function(result) {
                return result == isShowing;
            });
        });
    }
    it("Reconnects session sockets on server restart", function(done) {
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("regular1");
        var sock;
        var session = event.get("sessions").at(0);
        browser.get(
            "http://localhost:7777/test/hangout/" + session.id + "/"
        ).then(function() {
            common.authedSock("regular2", session.getRoomId(), function(thesock) {
                sock = thesock;
            });
        });
        browser.waitTime(200).then(function () {
            expect(session.get("connectedParticipants").length).to.be(2);
            common.restartServer(function onStopped(restart) {
                framedDisconnectionModalShowing(true).then(function() {
                    restart();
                });
            }, function onRestarted() {
                framedDisconnectionModalShowing(false);
                browser.waitTime(100).then(function() {
                    // Refresh session from new DB.
                    event = common.server.db.events.get(event.id);
                    session = event.get("sessions").get(session.id);
                    expect(session.getNumConnectedParticipants()).to.be(1);
                    done();
                });
            });
        });
    });
});

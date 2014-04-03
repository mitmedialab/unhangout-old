var expect = require('expect.js'),
    _ = require("underscore"),
    common = require('./common'),
    models = require("../lib/server-models.js"),
    Promise = require("bluebird");
    requests = require("superagent");

describe("SESSION JOINING PARTICIPANT LISTS", function() {
    var browser = null,
        event = null;

    // Different leave-stop-timeout to monkey-patch in to test leave-stops.
    // Selenium is not compatible with sinon.useFakeTimers, so tests have to
    // wait this long in real-time.
    var ORIG_LEAVE_STOP_TIMEOUT;
    var TEST_LEAVE_STOP_TIMEOUT = 3000;
    var ORIG_JOINING_TIMEOUT;
    var TEST_JOINING_TIMEOUT = 3000;

    if (process.env.SKIP_SELENIUM_TESTS) {
        return;
    }
    this.timeout(60000); // Extra long timeout for selenium :(

    before(function(done) {
        // Reduce joining timeout to speed up the test.
        ORIG_LEAVE_STOP_TIMEOUT = models.ServerSession.prototype.HANGOUT_LEAVE_STOP_TIMEOUT;
        ORIG_JOINING_TIMEOUT = models.ServerSession.prototype.JOINING_EXPIRATION_TIMEOUT;
        models.ServerSession.prototype.HANGOUT_LEAVE_STOP_TIMEOUT = TEST_LEAVE_STOP_TIMEOUT;
        models.ServerSession.prototype.JOINING_EXPIRATION_TIMEOUT = TEST_JOINING_TIMEOUT;
        common.stopSeleniumServer().then(function() {
            common.getSeleniumBrowser(function (theBrowser) {
                browser = theBrowser;
                common.standardSetup(function() {
                    event = common.server.db.events.findWhere({shortName: "writers-at-work"});
                    event.start();
                    done();
                });
            });
        });
    });
    after(function(done) {
        models.ServerSession.prototype.HANGOUT_LEAVE_STOP_TIMEOUT = ORIG_LEAVE_STOP_TIMEOUT;
        models.ServerSession.prototype.JOINING_EXPIRATION_TIMEOUT = ORIG_JOINING_TIMEOUT;
        browser.quit().then(function() {
            common.standardShutdown(done);
        });
    });

    it("Updates session participant list when not present in the event", function(done) {
        var session = event.get("sessions").at(0);
        var sock;
        var participantList = "#session-list .session[data-session-id='" + session.id + "'] li";
        var ready = false;
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("regular1");
        browser.get("http://localhost:7777/event/" + event.id);
        browser.waitForScript("$");
        browser.byCsss("#presence-gutter .user").then(function(els) {
            expect(els.length).to.be(1);
        });
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
                sock.on("data", function(message) {});
            });
        });
        // Now we should have a user show up in the participant list.
        browser.waitForSelector(participantList + " i.icon-user").then(function() {
            expect(session.getNumConnectedParticipants()).to.be(1);
            expect(session.getState()).to.be("no url");
            return sock.promiseClose();
        });
        // The participant list should clear when the socket closes.
        browser.wait(function() {
            return browser.byCsss(participantList + " i.icon-user").then(function(els) {
                return els.length === 0;
            });
        }).then(function() {
            expect(session.getNumConnectedParticipants()).to.be(0);
            // Should stop immediately when there's no hangout URL to preserve.
            expect(session.getState()).to.be("stopped");
            done();
        });
    });
    it("Updates session participant list when present in the event", function(done) {
        var sock1, sock2;
        var session = event.get("sessions").at(0);
        var participantList = "#session-list .session[data-session-id='" + session.id + "'] li";
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("regular1");
        // Connect the browser to the event page, then connect a socket
        // belonging to the same user to both event and session rooms.
        browser.get("http://localhost:7777/event/" + event.id);
        browser.waitForScript("$").then(function() {
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
            return sock1.promiseClose();
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
            expect(session.getState()).to.be("no url");
        }).then(function() {
            // Leave!
            return sock2.promiseClose();
        });
        // Now noone should be left
        browser.wait(function() {
            return browser.byCsss(participantList + " i.icon-user").then(function(els) {
                return els.length == 0;
            });
        }).then(function() {;
            expect(session.getNumConnectedParticipants()).to.be(0);
            expect(session.getState()).to.be("stopped");
            done();
        });
    });

    it("Handles stop conditions when session has been deleted", function(done) {
        var session = event.get("sessions").at(0);
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("admin1");
        // Visit the session to "start" it.
        browser.get("http://localhost:7777/test/hangout/" + session.id + "/");
        browser.wait(function() {
            return session.getState() === "started";
        });
        // Then leave, by going to the event page, where we'll delete it.
        browser.get("http://localhost:7777/event/" + event.id);
        browser.wait(function() {
            return session.getState() === "stopping";
        });
        browser.waitForScript("$");
        browser.byCss("[data-session-id='" + session.id + "'] .delete").click();
        browser.then(function() {
            setTimeout(function() {
                // We're left untouched, as a 'save' would throw an error.
                expect(session.getState()).to.eql("stopping overdue; uncleared stopping; stale url; unstopped");
                done();
            }, TEST_LEAVE_STOP_TIMEOUT + 1);
        });
    });

    it("Correctly stops permalink sessions", function(done) {
        // Ensure that permalink sessions aren't broken by the logic that
        // prevents deleted sessions from being stopped.
        var session = new models.ServerSession({
            isPermalinkSession: true,
            shortCode: "test"
        }, {collection: common.server.db.permalinkSessions});
        common.server.db.permalinkSessions.add(session);
        session.save({}, {
            success: function() {
                browser.get("http://localhost:7777/");
                browser.mockAuthenticate("regular1");
                browser.get("http://localhost:7777/test/hangout/" + session.id + "/");
                browser.wait(function() {
                    return session.getState() == "started";
                });
                // leave..
                browser.get("http://localhost:7777/").then(function() {
                    expect(session.getState()).to.eql("stopping");
                    setTimeout(function() {
                        expect(session.getState()).to.eql("stopped");
                        done();
                    }, TEST_LEAVE_STOP_TIMEOUT + 1);
                });
            },
            error: function(err) {
                done(err);
            }
        });
    });

    function disconnectionModalShowing(isShowing) {
        return browser.wait(function() {
            return browser.executeScript(
                "return window.$ && $('#disconnected-modal').is(':visible')"
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
        browser.get("http://localhost:7777/event/" + event.id);
        browser.waitForScript("$").then(function() {
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
        browser.wait(function() {
            return session.get("connectedParticipants").length == 2;
        }).then(function() {
            common.restartServer(function onStopped(restart) {
                framedDisconnectionModalShowing(true).then(function() {
                    restart();
                });
            }, function onRestarted() {
                framedDisconnectionModalShowing(false);
                browser.waitTime(5000).then(function() {
                    // Refresh session from new DB.
                    event = common.server.db.events.get(event.id);
                    session = event.get("sessions").get(session.id);
                    expect(session.getNumConnectedParticipants()).to.be(1);
                    done();
                });
            });
        });
    });

    it("Warns you when you're in the wrong hangout", function(done) {
        var session = event.get("sessions").at(0);
        var button = "document.getElementsByTagName('iframe')[0].contentWindow" +
                     ".document.getElementsByTagName('iframe')[0].contentWindow" +
                     ".document.getElementById('wrong-hangout-url')"
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("regular1").then(function() {
            session.set("hangout-url", "http://example.com/");
        });
        browser.get("http://localhost:7777/test/hangout/" + session.id + "/");
        browser.wait(function() {
            return browser.executeScript("return !!" + button + ";");
        });
        browser.executeScript("return " + button + ".href").then(function(href) {
            expect(href).to.be("http://example.com/");
        });
        // Go to a different URL that won't throw a modal dialog up.
        browser.get("http://localhost:7777/").then(function() {
            done();
        });
    });

    it("Doesn't clear hangout URL immediately, but rather after a delay.", function(done) {
        var session = event.get("sessions").at(1);
        session.set("hangoutConnected", false);
        session.set("hangout-url", null);
        common.authedSock("regular1", session.getRoomId()).then(function(sock) {
            sock.on("data", function(message) {
                var msg = JSON.parse(message);
                if (msg.type == "session/set-hangout-url-ack") {
                    expect(session.get("hangout-url")).to.not.be(null);
                    sock.write(JSON.stringify({
                        type: "leave",
                        args: {id: session.getRoomId()}
                    }));
                } else if (msg.type == "leave-ack") {
                    expect(session.getNumConnectedParticipants()).to.be(0);
                    expect(session.get("hangout-url")).to.not.be(null);
                    // We don't test that it actually gets invalidated here,
                    // because the delay is LONG, and sinon doesn't play well
                    // with asynchronous socket comms.
                    sock.promiseClose().then(done);
                } else {
                    sock.promiseClose().then(function() {
                        done(new Error("Unexpected message: " + message));
                    });
                }
            });
            sock.write(JSON.stringify({
                type: "session/set-hangout-url",
                args: {
                    url: "http://example.com",
                    sessionId: session.id
                },
            }));
        });
    });

    it("Doesn't set connected participants if URL is invalid.", function(done) {
        var session = event.get("sessions").at(1);
        var participants = [{id: "p1", displayName: "P1", picture: ""},
                            {id: "p2", displayName: "P2", picture: ""},
                            {id: "0", displayName: "Regular1 Mock", picture: ""}];
        session.set("hangout-url", "http://example.com");
        session.set("connectedParticipants", participants);

        common.authedSock("regular1", session.getRoomId()).then(function(sock) {
            sock.on("data", function(message) {
                var msg = JSON.parse(message);
                if (msg.type === "session/set-connected-participants-err") {
                    expect(msg.args).to.eql("Not in correct hangout");
                    expect(session.get("connectedParticipants")).to.eql(participants);
                    sock.promiseClose().then(done);
                } else {
                    sock.promiseClose().then(function() {
                        done(new Error("Unexpected message: " + message));
                    });
                }
            });
            sock.write(JSON.stringify({
                type: "session/set-connected-participants",
                args: {
                    sessionId: session.id,
                    "hangout-url": "http://example2.com",
                    connectedParticipants: [
                        {id: "0", displayName: "Regular1 Mock", picture: ""}
                    ]
                }
            }));
        });
    });

    it("Adds joining participant UI", function(done) {
        var session = event.get("sessions").at(0);
        var u1 = common.server.db.users.findWhere({"sock-key": "regular1"});
        var u2 = common.server.db.users.findWhere({"sock-key": "regular2"});

        browser.get("http://localhost:7777/");
        browser.mockAuthenticate(u1.getSockKey());
        browser.get("http://localhost:7777/event/" + event.id);
        browser.waitForScript("$");
        browser.then(function() {
            return new Promise(function (resolve, reject) {
                var url = "http://localhost:7777/session/" + session.get("session-key");
                requests.get(url)
                    .set("x-mock-user", u2.getSockKey())
                    .redirects(0)
                    .end(function(res) {
                        expect(res.status).to.be(302);
                        expect(session.get("joiningParticipants")).to.eql([{
                            id: u2.id,
                            displayName: u2.get("displayName"),
                            picture: u2.get("picture")
                        }]);
                        resolve();
                    });
            });
        });
        browser.waitForSelector(".hangout-users li.user.joining");
        browser.byCsss(".hangout-users li.user.joining").then(function(els) {
            expect(els.length).to.be(1);
        });
        browser.waitTime(models.ServerSession.prototype.JOINING_EXPIRATION_TIMEOUT + 2000);
        browser.byCsss(".hangout-users li.user.joining").then(function(els) {
            expect(els.length).to.be(0);
            expect(session.get("joiningParticipants").length).to.be(0);
            done();
        });
    });
});

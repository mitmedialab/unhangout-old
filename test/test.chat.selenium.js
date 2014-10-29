var server      = require('../lib/unhangout-server'),
    async       = require('async'),
    expect      = require("expect.js"),
    _           = require('underscore'),
    common      = require('./common');

describe("CHAT", function() {
    var browser = null;
    var sock = null;
    var evt = null;

    if (process.env.SKIP_SELENIUM_TESTS) { return; }
    this.timeout(60000); // Extra long timeout for selenium :(

    before(function(done) {
        this.timeout(240000);
        async.series([
            function(done) {
                common.getSeleniumBrowser(function (theBrowser) {
                    browser = theBrowser;
                    done();
                });
            },
            function(done) {
                common.standardSetup(function() {
                    evt = common.server.db.events.findWhere({shortName: "writers-at-work"});
                    evt.set("open", true);
                    done();
                });
            },
            function(done) {
                common.authedSock("regular2", evt.getRoomId(), function(theSock) {
                    sock = theSock;
                    done();
                });
            }
        ], function() {
            done();
        });
    });
    after(function(done) {
        browser.quit().then(function() {
            sock.promiseClose().then(function() {
                common.restoreTimers();
                common.standardShutdown(done);
            });
        });
    });

    function checkScroll(browser, isScrolledDown) {
        return browser.executeScript("return [$('#chat-container-region .panel-body').scrollTop(), $('#chat-container-region .panel-body')[0].scrollHeight - $('#chat-container-region .panel-body').height()];").then(function(scrolls) {
            var scrollTop = scrolls[0],
                maxScroll = scrolls[1];
            if (isScrolledDown) {
                expect(Math.abs(scrollTop - maxScroll)).to.be.lessThan(2);
            } else {
                expect(scrollTop).to.be.lessThan(maxScroll);
            }
        });
    }

    it("scrolls chat window", function(done) {
        browser.mockAuthenticate("regular1");
        browser.get(common.URL + "/event/" + evt.id);
        browser.waitForEventReady(evt, "regular1");
        browser.waitForSelector("#chat-input");
        var msgCount = 50;
        for (var i = 0; i < msgCount; i++) {
            browser.byCss("#chat-input").sendKeys("msg " + i + "\n");
        }
        browser.wait(function() {
            return browser.byCsss("li.chat-message").then(function(els) {
                return els.length == msgCount;
            });
        });
        checkScroll(browser, true);
        browser.executeScript('$("#chat-container-region .panel-body").scrollTop(100)');
        checkScroll(browser, false)
        browser.byCss("#chat-input").sendKeys("msg " + i + "\n");
        checkScroll(browser, true).then(function() { done(); });
        browser.executeScript('$("#chat-container-region .panel-body").scrollTop(100)').then(function() {;
            // Send a message from another user.
            sock.write(JSON.stringify({
                type: "chat", args: {text: "Other user message",
                                     roomId: evt.getRoomId()}
            }));
        });

        // wait for the message to arrive...
        browser.wait(function() {
            return function() {
                var lastMessage = "return $('.chat-message:last').text();"
                return browser.executeScript(lastMessage).then(function(text) {
                    return text == "Other user message";
                });
            }
        });
        checkScroll(browser, false)


        // Try a micro-scroll to ensure slop works.
        var scrollFunc = 'var el = $("#chat-container-region .panel-body"); ' +
                         'el.scrollTop(el[0].scrollHeight - el.height() - 5); ' +
                         'return el.scrollTop();';
        browser.executeScript(scrollFunc).then(function() {
            sock.write(JSON.stringify({
                type: "chat", args: {text: "Other user message 2"}
            }));
        });
        browser.wait(function() {
            return function() {
                var lastMessage = "return $('.chat-message:last').text();"
                return browser.executeScript(lastMessage).then(function(text) {
                    return text == "Other user message 2";
                });
            }
        });
        checkScroll(browser, false);

    });

    it("optionally highlights admin chat messages", function(done) {
        var event = common.server.db.events.get(1);
        var regular = common.server.db.users.findWhere({"sock-key": "regular1"});
        var admin = common.server.db.users.findWhere({"sock-key": "admin1"})
        var superuser = common.server.db.users.findWhere({superuser: true});
        // chat coloring only works for admins specified by ID, not email...
        event.set("admins", [{id: admin.id}]);

        // Make sure our users are as we expect.
        expect(regular.isAdminOf(event)).to.be(false)
        expect(admin.isAdminOf(event)).to.be(true)
        expect(superuser.isAdminOf(event)).to.be(true);
        // Get the page so we can mock-authenticate.
        browser.get(common.URL + "/event/" + event.id);

        var counter = 0;
        function waitForMsg(text) {
          browser.wait(function() {
              var lastMessage = "return $('.chat-message:last').text();";
              return browser.executeScript(lastMessage).then(function(msg) {
                  return msg.indexOf(text.trim()) !== -1;
              });
          });
        }
        function lastMsgIsAdmin(isAdmin) {
            var isAdminMessage = "return $('.chat-message:last .from').hasClass('admin');"
            browser.executeScript(isAdminMessage).then(function(msgIsAdmin) {
                expect(msgIsAdmin).to.be(isAdmin);
            });
        }
        function checkFromAdmin(sockkey, isAdmin) {
            var text = "admin check " + (counter++) + "\n";
            browser.mockAuthenticate(sockkey);
            browser.get(common.URL + "/event/" + event.id)
            browser.waitForEventReady(event, sockkey);
            browser.waitForSelector("#chat-input");
            // Send a message as an admin.
            if (isAdmin) {
                browser.byCss("[name='chat-as-admin']").click();
            } else {
                browser.byCsss("[name='chat-as-admin']").then(function(els) {
                    expect(els.length).to.be(0);
                });
            }
            browser.byCss("#chat-input").sendKeys(text);
            waitForMsg(text);
            lastMsgIsAdmin(isAdmin);
            if (isAdmin) {
                text = "admin check " + (counter++) + "\n";
                // Send message as non-admin.
                browser.byCss("[name='chat-as-admin']").click();
                browser.byCss("#chat-input").sendKeys(text);
                waitForMsg(text);
                var isAdminMessage = "return $('.chat-message:last .from').hasClass('admin');"
                lastMsgIsAdmin(false);
            }
        }

        checkFromAdmin(regular.getSockKey(), false);
        checkFromAdmin(superuser.getSockKey(), true);
        checkFromAdmin(regular.getSockKey(), false);
        checkFromAdmin(admin.getSockKey(), true);

        browser.then(function() { done(); });
    });

    it("Detects @usernames in chat", function(done) {
        browser.mockAuthenticate("regular1");
        browser.get(common.URL + "/event/" + evt.id);
        browser.waitForSelector("#chat-input");
        browser.byCss("#chat-input").sendKeys("Hello, @Regular2\n");
        browser.waitForSelector("b.atname");
        browser.byCss("b.atname").getAttribute("data-original-title").then(function(title) {
            expect(title).to.be("Regular2 Mock");
        });
        browser.then(function() {
            sock.write(JSON.stringify({
                type: "chat",
                args: {text: "Well hi, @regular1mock\n", roomId: evt.getRoomId()},
            }));
        });
        browser.waitForSelector("b.atname.me");
        browser.byCss("b.atname.me").getAttribute("data-original-title").then(function(title) {
            expect(title).to.be("Regular1 Mock");
        });
        browser.then(function() {
            done();
        });
    });
});


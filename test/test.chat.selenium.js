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
                common.authedSock("regular2", evt.id, function(theSock) {
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
                common.standardShutdown(done);
            });
        });
    });

    function checkScroll(browser, isScrolledDown) {
        return browser.executeScript("return [$('#chat-container-region').scrollTop(), $('#chat-container-region')[0].scrollHeight - $('#chat-container-region').height()];").then(function(scrolls) {
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
        browser.get(common.URL);
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
        browser.executeScript('$("#chat-container-region").scrollTop(100)');
        checkScroll(browser, false)
        browser.byCss("#chat-input").sendKeys("msg " + i + "\n");
        checkScroll(browser, true).then(function() { done(); });
        browser.executeScript('$("#chat-container-region").scrollTop(100)').then(function() {;
            // Send a message from another user.
            sock.write(JSON.stringify({
                type: "chat", args: {text: "Other user message"}
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
        var scrollFunc = 'var el = $("#chat-container-region"); ' +
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

    it("displays admin chat messages with a different color", function(done) {
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
        function checkFromAdmin(sockkey, isAdmin) {
            var text = "admin check " + (counter++) + "\n";
            browser.mockAuthenticate(sockkey);
            browser.get(common.URL + "/event/" + event.id)
            browser.waitForEventReady(event, sockkey);
            browser.waitForSelector("#chat-input");
            browser.byCss("#chat-input").sendKeys(text);
            browser.wait(function() {
                var lastMessage = "return $('.chat-message:last').text();";
                return browser.executeScript(lastMessage).then(function(msg) {
                    return msg.indexOf(text.trim()) !== -1;
                });
            });
            var isAdminMessage = "return $('.chat-message:last .from').hasClass('admin');"
            browser.executeScript(isAdminMessage).then(function(msgIsAdmin) {
                expect(msgIsAdmin).to.be(isAdmin);
            });
        }

        checkFromAdmin(regular.getSockKey(), false);
        checkFromAdmin(superuser.getSockKey(), true);
        checkFromAdmin(regular.getSockKey(), false);
        checkFromAdmin(admin.getSockKey(), true);

        browser.then(function() { done(); });

    });
});


var server      = require('../lib/unhangout-server'),
    async       = require('async'),
    should      = require('should'),
    _           = require('underscore'),
    sock_client = require("sockjs-client-ws"),
    common      = require('./common');

var browser = null;
var sock = null;
var evt = null;

describe("CHAT WINDOW", function() {
    if (process.env.SKIP_SELENIUM_TESTS) { return; }
    this.timeout(40000); // Extra long timeout for selenium :(

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
                    evt = common.server.db.events.at(0);
                    evt.start();
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
            sock.close();
            common.standardShutdown(done);
        });
    });

    function checkScroll(browser, isScrolledDown) {
        return browser.executeScript("return [$('#chat-container').scrollTop(), $('#chat-container')[0].scrollHeight - $('#chat-container').height()];").then(function(scrolls) {
            var scrollTop = scrolls[0],
                maxScroll = scrolls[1];
            if (isScrolledDown) {
                should.equal(Math.abs(scrollTop - maxScroll) < 2, true);
            } else {
                should.equal(scrollTop < maxScroll, true);
            }
        });
    }

    it("scrolls chat window", function(done) {
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("regular1");
        browser.get("http://localhost:7777/event/" + evt.id);
        var msgCount = 100;
        for (var i = 0; i < msgCount; i++) {
            browser.byCss("#chat-input").sendKeys("msg " + i + "\n");
        }
        browser.wait(function() {
            return browser.byCsss("li.chat-message").then(function(els) {
                return els.length == msgCount + 1;
            });
        });
        checkScroll(browser, true);
        browser.executeScript('$("#chat-container").scrollTop(100)');
        checkScroll(browser, false)
        browser.byCss("#chat-input").sendKeys("msg " + i + "\n");
        checkScroll(browser, true).then(function() { done(); });
        browser.executeScript('$("#chat-container").scrollTop(100)').then(function() {;
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
        var scrollFunc = 'var el = $("#chat-container"); ' +
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
});
    

var server      = require('../lib/unhangout-server'),
    should      = require('should'),
    _           = require('underscore'),
    sock_client = require("sockjs-client"),
    common      = require('./common');

var browser = null;
var sock = null;

describe("CHAT WINDOW", function() {
    if (process.env.SKIP_SELENIUM_TESTS) { return; }
    this.timeout(120000); // Extra long timeout for selenium :(

    before(function(done) {

        common.getSeleniumBrowser(function (theBrowser) {
            browser = theBrowser;
            common.mockSetup(false)(function() {
                //sock = sock_client.create("http://localhost:7777/sock");
                done();
            });
        });
    });
    after(function(done) {
        browser.quit().then(function() { 
            common.standardShutdown(done);
        });
    });

    function checkScroll(browser, isScrolledDown) {
        return browser.executeScript("return [$('#chat-container').scrollTop() + $('#chat-container').height(), $('#chat-container')[0].scrollHeight];").then(function(scrolls) {
            var curScroll = scrolls[0],
                scrollHeight = scrolls[1];
            if (isScrolledDown) {
                should.equal(curScroll, scrollHeight);
            } else {
                should.strictEqual(curScroll < scrollHeight, true);
            }
        });
    }

    it("scrolls chat window", function(done) {
        var evt = common.server.events.at(0);
        evt.start();
        browser.get("http://localhost:7777/event/" + evt.id);
        var msgCount = 100;
        for (var i = 0; i < msgCount; i++) {
            browser.byCss("#chat-input").sendKeys("msg " + i + "\n");
        }
        browser.wait(function() {
            return browser.byCsss("div.chat-message").then(function(els) {
                return els.length == msgCount + 1;
            });
        });
        checkScroll(browser, true);
        browser.executeScript('$("#chat-container").scrollTop(100)');
        checkScroll(browser, false)
        browser.byCss("#chat-input").sendKeys("msg " + i + "\n");
        checkScroll(browser, true).then(function() { done(); });
        // TODO: Get multiple mocked users going, and test messages coming in
        // from another client.
    });
});
    

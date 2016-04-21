var expect = require('expect.js'),
    common = require('./common');

describe("IFRAME EMBEDS", function() {
    var browser = null;
    if (process.env.SKIP_SELENIUM_TESTS) {
        return;
    }
    this.timeout(80000); // Extra long timeout for selenium :(
    before(function(done) {
        this.timeout(240000);
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

    it("Tries IFRAME Embed Code", function (done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        event.set("open", true);
        iframeCode = '<iframe src="https://player.vimeo.com/video/90475288"></iframe>';
        iframeSrc = "https://player.vimeo.com/video/90475288";
        browser.mockAuthenticate("superuser1");
        tryEmbed(iframeCode);
        browser.get(common.FAST_URL);
        browser.then(function() {
            expect(event.get("youtubeEmbed")).to.eql(null);
            expect(event.get("iframeEmbedCode")).to.eql(iframeCode);
            done();
        });

        function tryEmbed(code) {
            ytId = "pco91kroVgQ";
            browser.get(common.FAST_URL).then(function() {
                event.set("youtubeEmbed", ytId);
            });
            browser.get(common.URL + "/event/" + event.id);
            browser.waitForEventReady(event, "superuser1", 45000);
            browser.byCss(".embed-ls").click();
            browser.waitForSelector("textarea#iframe_code", 45000);
            browser.byCss("textarea#iframe_code").sendKeys(code);
            browser.byCss("#set-iframe-code").click();                 
        }
    });
});

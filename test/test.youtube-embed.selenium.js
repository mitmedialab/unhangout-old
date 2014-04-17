var expect = require('expect.js'),
    common = require('./common');

describe("YOUTUBE EMBEDS", function() {
    var browser = null;

    if (process.env.SKIP_SELENIUM_TESTS) {
        return;
    }
    this.timeout(60000); // Extra long timeout for selenium :(

    before(function(done) {
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

    // NOTE: Would be better to do this test using the video parsing function
    // directly (public/js/videos.js -> video.extractYoutubeId), but that would
    // require loading the requirejs format frontend library using amdefine or
    // some such and getting it to load properly with all the front-end
    // libraries it uses (_, $, Backbone, logger).  This approach is much
    // slower to execute, but works, and easier to bootstrap.
    it("Tries a variety of YouTube urls", function (done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        var ytId = "pco91kroVgQ";
        event.start();

        function tryEmbed(url, success) {
            browser.get("http://localhost:7777/").then(function() {
                event.set("youtubeEmbed", "");
            });
            browser.get("http://localhost:7777/event/" + event.id);
            browser.waitForSelector(".inline-video-controls [name=youtube_id]", 45000);
            browser.byCss(".inline-video-controls [name=youtube_id]").sendKeys(url);
            browser.byCss(".set-video").click();
            if (success) {
                // Wait for embed to finish..
                browser.waitForSelector("iframe", 45000);
                return browser.byCss("iframe").getAttribute("src").then(function(src) {
                    var url = "http://www.youtube.com/embed/" + ytId + "?";
                    expect(src.substring(0, url.length)).to.eql(url);
                    expect(event.get("youtubeEmbed")).to.eql(ytId);
                });
            } else {
                browser.wait(function() {
                    return browser.byCsss(".text-warning").then(function(els) {
                        return els.length > 0;
                    });
                });
                return browser.byCss(".text-warning").getText().then(function(text) {
                    expect(text.indexOf("Unrecognized youtube URL")).to.not.eql(-1);
                });
            }
        }
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("superuser1");
        tryEmbed(ytId, true);
        tryEmbed("foo", false);
        tryEmbed("http://www.youtube.com", false);
        tryEmbed("https://www.youtube.com/watch?v=" + ytId, true);
        tryEmbed("http://www.youtube.com/embed/" + ytId, true);
        tryEmbed("http://www.youtube.com/v/" + ytId + "?fs=1&hl=en_US", true);
        tryEmbed("http://www.youtube.com/watch?feature=player_embedded&v=" + ytId, true);
        tryEmbed("https://youtu.be/" + ytId, true).then(function() {
            done();
        });
    });

    it("Clears the list of videos", function(done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        event.start();
        event.set("previousVideoEmbeds", [
            {youtubeId: "wd9OY0E8A98"},
            {youtubeId: "gjPr7sfS5bs"},
            {youtubeId: "4DUz4tzhv-w"},
            {youtubeId: "2laB2BmSNn0"}
        ]);
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("superuser1");
        browser.get("http://localhost:7777" + event.getEventUrl());
        browser.waitForSelector(".inline-video-controls .dropdown-toggle");
        browser.byCss(".inline-video-controls .dropdown-toggle").click();
        browser.waitForSelector(".clear-previous-videos");
        browser.byCsss(".restore-previous-video:not(.header)").then(function(els) {
            expect(els.length).to.be(event.get("previousVideoEmbeds").length);
        });
        browser.byCss(".clear-previous-videos").click();
        browser.switchTo().alert().accept();
        browser.wait(function() {
            return event.get("previousVideoEmbeds").length === 0;
        }).then(function() {
            done();
        });
    });
});


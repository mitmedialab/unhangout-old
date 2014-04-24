var expect = require('expect.js'),
    common = require('./common'),
    extractYoutubeId = require("../public/js/extract-youtube-id");

describe("YOUTUBE EMBEDS", function() {
    var browser = null;

    if (process.env.SKIP_SELENIUM_TESTS) {
        return;
    }
    this.timeout(80000); // Extra long timeout for selenium :(

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

    it("Clears the list of videos", function(done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        event.set("open", true);
        event.set("previousVideoEmbeds", [
            {youtubeId: "wd9OY0E8A98"},
            {youtubeId: "gjPr7sfS5bs"},
            {youtubeId: "4DUz4tzhv-w"},
            {youtubeId: "2laB2BmSNn0"}
        ]);
        browser.get(common.URL);
        browser.mockAuthenticate("superuser1");
        browser.get(common.URL + event.getEventUrl());
        browser.waitForEventReady(event, "superuser1");
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

    it("Tries a variety of YouTube urls", function (done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        var ytId = "pco91kroVgQ";
        event.set("open", true);

        function tryEmbed(url, success) {
            browser.get(common.URL).then(function() {
                event.set("youtubeEmbed", "");
            });
            browser.get(common.URL + "/event/" + event.id);
            browser.waitForEventReady(event, "superuser1", 45000);
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
        browser.get(common.URL);
        browser.mockAuthenticate("superuser1");
        tryEmbed(ytId, true);
        tryEmbed("foo", false);
        tryEmbed("https://www.youtube.com/watch?v=" + ytId, true);
        browser.get(common.URL);
        browser.then(function() {
            done();
        });
    });

    it("Extracts youtube ID's", function() {
        var ytId = "pco91kroVgQ";


        function tryExtract(url, success) {
            var res = extractYoutubeId.extractYoutubeId(url);
            if (success) {
                expect(res).to.be(ytId);
            } else {
                expect(res).to.be(null);
            }
        }

        tryExtract("foo", false);
        tryExtract(ytId, true);
        tryExtract("http://www.youtube.com", false);
        tryExtract("http://www.youtube.com/embed/" + ytId, true);
        tryExtract("http://www.youtube.com/v/" + ytId + "?fs=1&hl=en_US", true);
        tryExtract("http://www.youtube.com/watch?feature=player_embedded&v=" + ytId, true);
        tryExtract("https://youtu.be/" + ytId, true);
        tryExtract('<iframe width="560" height="315" src="//www.youtube.com/embed/' + ytId + '" frameborder="0" allowfullscreen></iframe>', true);

    });
});


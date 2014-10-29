var expect = require('expect.js'),
    common = require('./common'),
    extractYoutubeId = require("../public/js/extract-youtube-id"),
    _ = require("underscore");

describe("PREVIOUS VIDEOS", function() {
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

    var PREVIOUS = [
        {youtubeId: "wd9OY0E8A98"},
        {youtubeId: "gjPr7sfS5bs"},
        {youtubeId: "4DUz4tzhv-w"},
        {youtubeId: "2laB2BmSNn0"}
    ];

    function prepEvent(event) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        event.set("open", true);
        event.set("previousVideoEmbeds", PREVIOUS);
        return event;
    }

    it("Removes individual videos", function(done) {
        var event = prepEvent();
        browser.mockAuthenticate("superuser1");
        browser.get(common.URL + event.getEventUrl());
        browser.waitForEventReady(event, "superuser1");
        browser.waitForSelector("#video-embed .dropdown-toggle");
        browser.byCss("#video-embed .dropdown-toggle").click();
        browser.byCss(".remove-one-previous-video[data-youtube-id='wd9OY0E8A98']").click();
        browser.wait(function() {
            return event.get("previousVideoEmbeds").length === PREVIOUS.length - 1;
        });
        browser.then(function() {
            var newPrevious = _.clone(PREVIOUS);
            newPrevious.shift();
            expect(event.get("previousVideoEmbeds")).to.eql(newPrevious);
        });
        browser.waitForSelector("#video-embed .dropdown-toggle");
        browser.byCss("#video-embed .dropdown-toggle").click();
        browser.byCsss(".previous-videos li", function(lis) {
            expect(lis.length).to.be(PREVIOUS.length - 1);
        });
        browser.then(function() {
            done();
        });
    });

    it("Clears the list of videos", function(done) {
        var event = prepEvent();
        browser.mockAuthenticate("superuser1");
        browser.get(common.URL + event.getEventUrl());
        browser.waitForEventReady(event, "superuser1");
        browser.waitForSelector("#video-embed .dropdown-toggle");
        browser.byCss("#video-embed .dropdown-toggle").click();
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

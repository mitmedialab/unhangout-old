var common = require("./common.js"),
    expect = require("expect.js"),
    googleapis = require("googleapis"),
    models = require("../lib/server-models"),
    webdriver = require("selenium-webdriver");

describe("CREATE HOA", function() {
    var browser;

    if (process.env.SKIP_SELENIUM_TESTS) {
        return;
    }
    this.timeout(60000); // Extra long timeout for selenium :(
    before(function(done) {
        common.getSeleniumBrowser(function(theBrowser) {
            browser = theBrowser;
            common.standardSetup(done);
        });

        //
        // Set up mocks for googleapis, so we can dance right past them.
        //

        googleapis.OAuth2Client = function() {
            this.generateAuthUrl = function() {
                return "http://localhost:7777/event/create-hoa/callback";
            };
            this.getToken = function(code, callback) {
                return callback(null, "mock-token");
            };
        }

        googleapis.discover = function(thingy, version) {
            return {
                execute: function(callback) {
                    // Callback with a fake 'client'
                    return callback(null, {
                        youtube: {
                            channels: {
                                list: function(opts) {
                                    return {
                                        withAuthClient: function(client) {
                                            return {
                                                execute: function(callback) {
                                                    return callback(null, {items: []});
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    });
                }
            }
        };
    });
    after(function(done) {
        browser.quit().then(function() {
            common.standardShutdown(done);
        });
    });

    it("creates an hoa with event page", function(done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        event.start();
        var user = common.server.db.users.findWhere({"sock-key": "admin1"});
        expect(user.isAdminOf(event)).to.be(true);

        var windowHandle;

        browser.get("http://localhost:7777/");
        browser.mockAuthenticate(user.get("sock-key"));
        browser.get("http://localhost:7777/event/" + event.id);
        browser.waitForSelector(".create-hoa");
        browser.byCss(".create-hoa").click();
        // Switch to the hangout creation window.
        // Seems that browser.getWindowHandles is not implemented.  Doing it raw.
        browser.schedule(
            new webdriver.Command(webdriver.CommandName.GET_WINDOW_HANDLES)
        ).then(function(handles) {
            browser.switchTo().window(handles[1]);
        });
        browser.wait(function() {
            return !!event.get("hoa");
        });
        browser.getCurrentUrl().then(function(url) {
            expect(event.get("hoa")).to.not.be(null);
            // This is the test URL -- not the URL used in production.. not
            // sure how valuable it is to test here, but at least we know that
            // the session redirect is running.
            expect(url).to.eql(
                "http://localhost:7777/test/hangout/" + event.get("hoa").id + "/?isHoA=1"
            );
        });

        // Switch back to the event window.
        browser.schedule(
            new webdriver.Command(webdriver.CommandName.GET_WINDOW_HANDLES)
        ).then(function(handles) {
            browser.switchTo().window(handles[0]);
        });

        browser.waitForSelector(".join-hoa");

        // Wait for the hangout broadcast video to be embedded.
        browser.waitForScript("$");
        var embedSrcScript = "return $('.video-player iframe').attr('src');";
        browser.executeScript(embedSrcScript).then(function(src) {
            expect(src).to.not.be(null);
            expect(src.indexOf("http://www.youtube.com/embed/" +
                               event.get("hoa").get("hangout-broadcast-id"))
            ).to.be(0);
        });
        browser.executeScript("return $('.join-hoa').attr('href');").then(function(href) {
            expect(href).to.eql(event.get("hoa").getParticipationLink());
        });

        // Now make sure that a regular user sees the embedded video, but does
        // not see the "join current hangout" link.
        browser.mockAuthenticate("regular1");
        browser.get("http://localhost:7777/event/" + event.id);
        browser.byCsss(".join-hoa").then(function(els) {
            expect(els.length).to.be(0);
        });
        browser.waitForSelector("iframe");
        browser.wait(function() {
            return browser.executeScript(embedSrcScript).then(function(src) {
                return src !== null && src.indexOf(
                    "http://www.youtube.com/embed/" +
                    event.get("hoa").get("hangout-broadcast-id")) === 0;
            });
        });

        browser.then(function() { done(); });
    });

    it("shows correct links for hoa statuses", function(done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        event.setHoA(null);
        event.start();
        var hoa;
        browser.get("http://localhost:7777");
        browser.mockAuthenticate("superuser1");
 
        // Get the page once -- the rest are live updates triggered by model
        // changes.
        browser.get("http://localhost:7777/event/" + event.id);
        browser.waitForScript("$");

        function hasHoA(has) {
            browser.wait(function() {
                return browser.byCsss("a.create-hoa").then(function(els) {
                    return els.length === (has ? 0 : 1);
                });
            });
            return browser.wait(function() {
                return browser.byCsss("a.join-hoa").then(function(els) {
                    return els.length === (has ? 1 : 0);
                });
            });
        };

        hasHoA(false).then(function() {
            // Add an hoa.
            hoa = new models.ServerHoASession();
            event.setHoA(hoa);
            hoa.markHangoutPending();
        });
        hasHoA(true).then(function() {
            hoa.set("hangout-pending", null);
        });
        hasHoA(false).then(function() {
            hoa.set("hangout-url", "http://example.com/hoa");
        });
        hasHoA(true);
        browser.byCss(".remove-hoa").click();
        hasHoA(false).then(function() {
            done();
        });
    });
});

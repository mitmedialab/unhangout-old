var common = require("./common.js"),
    expect = require("expect.js"),
    googleapis = require("googleapis"),
    models = require("../lib/server-models"),
    webdriver = require("selenium-webdriver"),
    request = require("superagent");

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
                return common.URL + "/event/create-hoa/callback";
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
        event.set("open", true);
        var user = common.server.db.users.findWhere({"sock-key": "admin1"});
        expect(user.isAdminOf(event)).to.be(true);

        var windowHandle;

        browser.get(common.URL);
        browser.mockAuthenticate(user.get("sock-key"));
        browser.get(common.URL + "/event/" + event.id);
        browser.waitForEventReady(event, user.get("sock-key"));
        browser.waitForSelector(".create-hoa");
        browser.byCss(".create-hoa").click();
        // Switch to the hangout creation window.
        // Seems that browser.getWindowHandles is not implemented.  Doing it raw.
        browser.schedule(
            new webdriver.Command(webdriver.CommandName.GET_WINDOW_HANDLES)
        ).then(function(handles) {
            browser.switchTo().window(handles[1]);
        });
        browser.waitForHangoutReady();
        browser.waitWithTimeout(function() {
            return !!event.get("hoa");
        });
        browser.getCurrentUrl().then(function(url) {
            expect(event.get("hoa")).to.not.be(null);
            // This is the test URL -- not the URL used in production.. not
            // sure how valuable it is to test here, but at least we know that
            // the session redirect is running.
            expect(url).to.eql(
                common.URL + "/test/hangout/" + event.get("hoa").id + "/?isHoA=1"
            );
        });

        // Switch back to the event window.
        browser.schedule(
            new webdriver.Command(webdriver.CommandName.GET_WINDOW_HANDLES)
        ).then(function(handles) {
            browser.switchTo().window(handles[0]);
        });

        // Wait for the hangout broadcast video to be embedded.
        browser.waitForScript("$");
        var embedSrcScript = "return $('.video-player iframe').attr('src');";
        browser.waitWithTimeout(function() {
            return browser.executeScript(embedSrcScript).then(function(src) {
                return (
                    src && event.get("hoa") && 
                    src.indexOf("http://www.youtube.com/embed/" +
                                event.get("hoa").get("hangout-broadcast-id")) === 0
                );
            });
        }, 60000);
        browser.executeScript("return $('.join-hoa').attr('href');").then(function(href) {
            expect(href).to.eql(event.get("hoa").getParticipationLink());
        });

        // Now make sure that a regular user sees the embedded video, but does
        // not see the "join current hangout" link.
        browser.mockAuthenticate("regular1");
        browser.get(common.URL + "/event/" + event.id);
        browser.waitForEventReady(event, "regular1");
        browser.byCsss(".join-hoa").then(function(els) {
            expect(els.length).to.be(0);
        });
        browser.waitForSelector("iframe");
        browser.waitWithTimeout(function() {
            return browser.executeScript(embedSrcScript).then(function(src) {
                return src !== null && src.indexOf(
                    "http://www.youtube.com/embed/" +
                    event.get("hoa").get("hangout-broadcast-id")) === 0;
            });
        }, 60000);

        browser.then(function() { done(); });
    });

    it("shows correct links for hoa statuses", function(done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        event.set("hoa", null);
        event.set("open", true);
        var hoa;
        browser.get(common.URL);
        browser.mockAuthenticate("superuser1");
 
        // Get the page once -- the rest are live updates triggered by model
        // changes.
        browser.get(common.URL + event.getEventUrl());
        browser.waitForEventReady(event, "superuser1");

        function hasHoA(has) {
            browser.waitWithTimeout(function() {
                return browser.byCsss("a.create-hoa").then(function(els) {
                    return els.length === (has ? 0 : 1);
                });
            });
            return browser.waitWithTimeout(function() {
                return browser.byCsss("a.join-hoa").then(function(els) {
                    return els.length === (has ? 1 : 0);
                });
            });
        };

        hasHoA(false).then(function() {
            // Add an hoa.
            hoa = new models.ServerHoASession();
            event.set("hoa", hoa);
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

    it("shows pending page for pending hoa's", function(done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        var hoa = new models.ServerHoASession();
        var user = common.server.db.users.findWhere({"sock-key": "admin1"});
        expect(user).to.not.be(undefined);
        event.set("hoa", hoa);
        hoa.markHangoutPending(user);
        expect(hoa.getParticipationLink()).to.eql("/hoa-session/" + hoa.get("session-key"));
        request.get(common.URL + hoa.getParticipationLink())
            .set("x-mock-user", "superuser1")
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(200);
                expect(res.text).to.contain("started creating a hangout-on-air");
                done();
            });
    });

    it("shows 'create new one' page for stale hoa's", function(done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        var hoa = new models.ServerHoASession()
        event.set("hoa", hoa);
        // not marking it pending -- nor giving it a URL.

        expect(hoa.getParticipationLink()).to.eql("/hoa-session/" + hoa.get("session-key"));
        request.get(common.URL + hoa.getParticipationLink())
            .set("x-mock-user", "superuser1")
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(200);
                expect(res.text).to.contain("looks like everyone has left the old");
                done();
            });
    });

    it("Doesn't error when creating a new hoa for events with a stale one (issue #330)", function(done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        var hoa = new models.ServerHoASession()
        hoa.event = event;
        event.set("hoa", hoa);
        hoa.save({}, {
            success: function() {
                request.get(common.URL + "/event/" + event.id + "/create-hoa/")
                    .set("x-mock-user", "superuser1")
                    .end(function(res) {
                        expect(event.get("hoa").id).to.not.eql(hoa.id);
                        expect(res.status).to.be(200);
                        done();
                    });
            }
        });
    });
});

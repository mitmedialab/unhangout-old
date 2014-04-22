var expect = require('expect.js'),
    _ = require("underscore"),
    common = require('./common');

describe("MOCK HANGOUT", function() {
    var browser = null,
        event = null,
        session = null;

    if (process.env.SKIP_SELENIUM_TESTS) {
        return;
    }
    this.timeout(60000); // Extra long timeout for selenium :(

    before(function(done) {
        this.timeout(80000);
        common.stopSeleniumServer().then(function() {
            common.getSeleniumBrowser(function (theBrowser) {
                browser = theBrowser;
                common.standardSetup(function() {
                    event = common.server.db.events.findWhere({shortName: "writers-at-work"});
                    event.start();
                    session = event.get("sessions").at(0);
                    done();
                });
            });
        });
    });
    after(function(done) {
        browser.quit().then(function() {
            common.standardShutdown(done);
        });
    });

    afterEach(function(done) {
        // Get a URL that won't throw modals at us.
        browser.get(common.URL + "/public/html/test.html").then(function() {
            done();
        });
    });

    it("Communicates the hangout's URL on connction.", function(done) {
        var u1 = common.server.db.users.at(0);
        browser.get(common.URL);
        browser.mockAuthenticate(u1.get("sock-key"));
        // At first, there's no hangout url..
        expect(session.get("hangout-url")).to.be(null);

        // but after we connect ...
        var url = common.URL + "/test/hangout/" + session.id + "/";
        browser.get(url);
        browser.waitForFunc(function() {
            return session.getNumConnectedParticipants() == 1;
        }).then(function() {;
            expect(session.get("hangout-url")).to.eql(url);
            expect(session.get("hangout-id")).to.eql(url + "-id");
            done();
        });
    });

    it("Updates connected participants who don't load app.", function(done) {
        var u1 = common.server.db.users.at(0);
        var u2 = common.server.db.users.at(1);
        var u3 = common.server.db.users.at(2);
        var u4 = common.server.db.users.at(3);
        var baseUrl = common.URL + "/test/hangout/" + session.id + "/";
        var queryUrl = baseUrl + "?mockUserIds=" + [u1.id, u2.id, u3.id].join(",");
        // Set the hangout URL because connectedParticipants will be refused if
        // it doesn't match the URL we get (which in the mock hangout will
        // include ?mockUserIds=...).
        session.set("hangout-url", queryUrl);
        
        browser.get(common.URL);
        browser.mockAuthenticate(u1.get("sock-key"));
        // First, load the hangout without extra users.
        browser.get(queryUrl);
        // Wait for iframe to load. Would be cleaner to introspect, but.. ugh.
        browser.waitForFunc(function() {
            return session.getNumConnectedParticipants() == 1;
        }).then(function() {
            expect(session.getNumConnectedParticipants()).to.be(1);
        });
        // Next, load the hangout with u2 and u3 as non-app users
        browser.get(queryUrl)
        browser.waitForFunc(function() {
            return session.getNumConnectedParticipants() == 3;
        }).then(function() {
            expect(_.pluck(session.get("connectedParticipants"), "id")).to.eql([
                u1.id, u2.id, u3.id
            ]);
            session.set("hangout-url", baseUrl);
            done();
        });
    });

    function hangoutShowsNoAuthError() {
        var frame = "document.querySelector('iframe').contentWindow.";
        return browser.wait(function() {
            return browser.executeScript("try { return " +
                frame + frame + "document.querySelector('.alert-error').innerHTML;" +
                "} catch (e) { return ''; }"
            ).then(function(html) {;
                return html.indexOf("We could not log you in to Unhangout.") != -1;
            });
        });
    }

    function hangoutShowsAboutActivity() {
        var frame = "document.querySelector('iframe').contentWindow.";
        return browser.wait(function() {
            return browser.executeScript("try { " +
                    "return " + frame + frame +
                        "document.querySelector('.about-activity p').innerHTML;" +
                "} catch (e) { return ''; }"
            ).then(function(html) {
                return html.indexOf("helps the Unhangout Permalink service") != -1;
            });
        });
    }

    it("Shows an auth error when not authenticated.", function(done) {
        // Clear any latent auth
        session.set("connectedParticipants", []);
        browser.get(common.URL);
        browser.unMockAuthenticate();
        browser.get(common.URL);
        browser.executeScript("return localStorage.removeItem('UNHANGOUT_AUTH');");

        browser.get(common.URL + "/test/hangout/" + session.id + "/");
        hangoutShowsNoAuthError().then(function() {
            expect(session.getNumConnectedParticipants()).to.be(0);
            done();
        });
    });

    it("Authenticates with local storage.", function(done) {
        // Set the mock cookie.
        session.set("connectedParticipants", []);
        browser.get(common.URL);
        browser.mockAuthenticate("regular1");
        // Now visit a page again, which should trigger setting local storage.
        browser.get(common.URL);
        // Remove auth cookie (but not localStorage).
        browser.unMockAuthenticate();
        browser.get(common.URL + "/test/hangout/" + session.id + "/");
        var frame = "document.querySelector('iframe').contentWindow.";
        // Now visit the hangout. We should be authed by local storage.
        hangoutShowsAboutActivity().then(function() {
            return common.await(function() {
                return session.getNumConnectedParticipants() == 1;
            });
        }).then(function() {
            done();
        });
    });

    it("Gets sock key from URL param if localStorage/cookie fail", function(done) {
        var user = common.server.db.users.findWhere({"sock-key": "regular1"});
        session.set("connectedParticipants", []);
        session.set("hangout-url", null);

        // Make sure we're logged out.
        browser.get(common.URL);
        browser.unMockAuthenticate();
        browser.executeScript("return localStorage.removeItem('UNHANGOUT_AUTH');");

        browser.get(common.URL + "/test/hangout/" + session.id + "/" +
                    "?sockKey=" + user.get("sock-key") +
                    "&userId=" + user.id);
        browser.waitForHangoutReady(session, user.get("sock-key"));
        hangoutShowsAboutActivity().then(function() {
            done();
        });
    });
});

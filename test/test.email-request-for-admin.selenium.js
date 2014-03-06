var expect = require('expect.js'),
    common = require('./common');

describe("EMAIL REQUEST FOR ADMIN (BROWSER)", function() {
    var browser = null;

    var longEnough = "This is a description that is long enough to meet the 100 char length validation for descriptions..."

    if (process.env.SKIP_SELENIUM_TESTS) {
        return;
    }
    this.timeout(40000); // Extra long timeout for selenium :(

    before(function(done) {
        common.getSeleniumBrowser(function (theBrowser) {
            browser = theBrowser;
            common.standardSetup(function() {
                common.startEmailServer(done);
            });
        });
    });
    after(function(done) {
        browser.quit().then(function() {
            common.standardShutdown(function() {
                common.stopEmailServer(done);
            });
        });
    });

    it("Is prompted to login when unauthenticated", function(done) {
        browser.get("http://localhost:7777/");
        browser.byCss(".create-event-button .btn-primary").click();
        browser.waitForSelector("#login-first-modal h3");
        browser.byCss("#login-first-modal h3").getText().then(function(text) {
            expect(text).to.eql("Please log in!");
            done();
        });
    });

    it("Is redirected to add-event when has permission to do so", function(done) {
        var user = common.server.db.users.findWhere({"sock-key": "regular1"});
        user.setPerm("createEvents", true);
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("regular1");
        browser.get("http://localhost:7777/");
        browser.byCss(".create-event-button .btn-primary").click()
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.be("http://localhost:7777/admin/event/new");
            done();
        });
    });
    it("Has a functioning request form when authenticated", function(done) {
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("regular2");
        browser.get("http://localhost:7777/");
        browser.byCss(".create-event-button .btn-primary").click();
        browser.waitForSelector("#event-mini-form-modal h3");
        browser.byCss("#event-mini-form-modal h3").getText().then(function(text) {
            expect(text).to.eql("Tell us about your event!");
        });

        var title = "#event-mini-form-modal [name='title']";
        var description = "#event-mini-form-modal [name='description']";
        var titleError = "#event-mini-form-modal .event-title label.error";
        var descriptionError = "#event-mini-form-modal .event-description label.error";
        var submit = "#event-mini-form-modal [type='submit']";
        // Rejects too-short titles
        browser.byCss(submit).click();
        browser.waitForSelector(titleError);
        browser.byCss(titleError).getText().then(function(text) {
            expect(text).to.eql("This field is required.");
        });
        browser.byCss(title).clear()
        browser.byCss(title).sendKeys("OK 5 then");
        browser.byCss(submit).click();
        browser.waitForSelector(descriptionError);
        browser.byCss(descriptionError).getText().then(function(text) {
            expect(text).to.eql("This field is required.");
        });
        browser.byCss(description).clear()
        browser.byCss(description).sendKeys(longEnough);
        browser.byCss(submit).click();

        browser.waitForSelector("#session-submission-modal h3");
        browser.byCss("#session-submission-modal h3").getText().then(function(text) {
            expect(text).to.eql("Thank you!!!");
            expect(common.outbox.length).to.be(1);
            var msg = common.outbox[0];
            expect(msg.subject).to.eql("Unhangout: Request for Admin Account");
            expect(msg.html.indexOf("OK 5 then")).to.not.eql(-1);
            expect(msg.html.indexOf(longEnough)).to.not.eql(-1);
            // Clear outbox.
            common.outbox.length = 0;
            done();
        });
    });
});

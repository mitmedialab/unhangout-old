var expect = require('expect.js'),
    common = require('./common');

var browser = null;

describe("BROWSER ADMIN USERS", function() {
    if (process.env.SKIP_SELENIUM_TESTS) {
        return;
    }
    this.timeout(40000); // Extra long timeout for selenium :(

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

    it("Can't access user page unauthenticated", function(done) {
        browser.get("http://localhost:7777/admin/users/");
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.not.eql("http://localhost:7777/admin/users/");
            done();
        });
    });
    it("Can't access user page as non-superuser", function(done) {
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("admin1");
        browser.get("http://localhost:7777/admin/users/")
        browser.getPageSource().then(function(source) {
            expect(source.indexOf("Permission denied")).to.not.eql(-1);
            done();
        });
    });
    it("Shows admin link for admins", function(done) {
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("admin1");
        browser.get("http://localhost:7777/");
        browser.byCss("#admin-nav a").click();
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.eql("http://localhost:7777/admin/");
            done();
        });
    });
    it("Shows admin link for superusers", function(done) {
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("superuser1");
        browser.get("http://localhost:7777/");
        browser.byCss("#admin-nav a").click();
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.eql("http://localhost:7777/admin/");
            done();
        });
    });
    it("Manages superusers", function(done) {
        var user = common.server.db.users.findWhere({superuser: false});
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("superuser1");
        browser.get("http://localhost:7777/admin/users/")
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.eql("http://localhost:7777/admin/users/");
        });
        var selector = "tr[data-user-id='" + user.id + "'] input[type='checkbox']";
        browser.byCss(selector).click().then(function() {
            expect(user.isSuperuser()).to.be(true);    
        });
        browser.byCss(selector).click().then(function() {
            expect(user.isSuperuser()).to.be(false);    
            done();
        });
    });
    it("Manages admins", function(done) {
        var user = common.server.db.users.findWhere({"sock-key": 'regular1'});
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        var eventUrl = "http://localhost:7777/admin/event/" + event.id;
        var addSelector = "tr[data-user-id='" + user.id + "'] .add-event";
        var removeSelector = "[data-event-id='" + event.id + "'].remove-event";

        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("superuser1");
        browser.get("http://localhost:7777/admin/users/")
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.eql("http://localhost:7777/admin/users/");
        });

        // Pull up the add event modal, and add an event.
        browser.byCss(addSelector).click();
        // Wait for modal to fade in...
        browser.waitForSelector(".modal-body select");
        browser.byCss(".modal-body select").sendKeys(event.get("title"));
        browser.byLinkText("Add").click().then(function() {
            expect(user.isAdminOf(event)).to.be(true);
        });

        // Ensure the new admin can access the admin page.
        browser.mockAuthenticate(user.get("sock-key"));
        browser.get(eventUrl);
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.eql(eventUrl);
        });

        // Remove admin-ship for this event.
        browser.mockAuthenticate("superuser1");
        browser.get("http://localhost:7777/admin/users/");
        browser.byCss(removeSelector).click().then(function() {
            expect(user.isAdminOf(event)).to.be(false);
        });

        // Ensure the new admin can no longer access the admin page.
        browser.mockAuthenticate(user.get("sock-key"));
        browser.get(eventUrl);
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.eql("http://localhost:7777/");
            done();
        });
    });
    it("Manages perms", function(done) {
        var user = common.server.db.users.findWhere({"sock-key": 'regular1'});
        var permSelector = "tr[data-user-id='" + user.id + "']" +
                           " input.perm[data-perm='createEvents']";

        expect(user.hasPerm("createEvents")).to.be(false);
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("superuser1");
        browser.get("http://localhost:7777/admin/users/");
        browser.byCss(permSelector).click();
        browser.wait(function() {
            if (user.hasPerm("createEvents") === true) {
                return true;
            }
        });
        browser.get("http://localhost:7777/admin/users/");
        browser.executeScript('return $("'+permSelector+'").is(":checked");').then(function(checked) {
            expect(checked).to.be(true);
        });
        browser.byCss(permSelector).click();
        browser.wait(function() {
            if (user.hasPerm("createEvents") === false) {
                return true;
            }
        });
        browser.get("http://localhost:7777/admin/users/");
        browser.executeScript('return $("'+permSelector+'").is(":checked");').then(function(checked) {
            expect(checked).to.be(false);
            done();
        });

    });
    it("Filters users", function(done) {
        browser.get("http://localhost:7777/");
        browser.mockAuthenticate("superuser1");
        browser.get("http://localhost:7777/admin/users/");
        browser.byCss("input.filter-input").sendKeys("Regular");
        browser.byCsss("tr").then(function(els) {
            expect(els.length).to.be(3);
            done();
        });
    });
});

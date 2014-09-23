var expect = require('expect.js'),
    common = require('./common');

describe("ADMIN USERS SELENIUM", function() {
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

    it("Can't access user page unauthenticated", function(done) {
        browser.get(common.URL + "/admin/users/");
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.not.eql(common.URL + "/admin/users/");
            done();
        });
    });
    it("Can't access user page as non-superuser", function(done) {
        browser.get(common.URL);
        browser.mockAuthenticate("admin1");
        browser.get(common.URL + "/admin/users/")
        browser.getPageSource().then(function(source) {
            expect(source.indexOf("Permission denied")).to.not.eql(-1);
            done();
        });
    });
    it("Shows admin link for admins", function(done) {
        browser.get(common.URL);
        browser.mockAuthenticate("admin1");
        browser.get(common.URL);
        browser.waitForSelector("#user-menu-label");
        browser.byCss("#user-menu-label").click();
        browser.waitForSelector("[href='/logout']")
        browser.byCss("[href='/admin/']").click();
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.eql(common.URL + "/admin/");
            done();
        });
    });
    it("Shows admin link for superusers", function(done) {
        browser.get(common.URL);
        browser.mockAuthenticate("superuser1");
        browser.get(common.URL);
        browser.waitForSelector("#user-menu-label");
        browser.byCss("#user-menu-label").click();
        browser.waitForSelector("[href='/logout']")
        browser.byCss("[href='/admin/']").click();
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.eql(common.URL + "/admin/");
            done();
        });
    });
    it("Manages superusers", function(done) {
        var user = common.server.db.users.findWhere({superuser: false});
        browser.get(common.URL);
        browser.mockAuthenticate("superuser1");
        browser.get(common.URL + "/admin/users/")
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.eql(common.URL + "/admin/users/");
        });
        var selector = "tr[data-user-id='" + user.id + "'] input[type='checkbox']";
        browser.waitForSelector(selector);
        browser.byCss(selector).click().then(function() {
            browser.wait(function() {
                return user.isSuperuser() === true;
            });
        });
        browser.byCss(selector).click().then(function() {
            browser.wait(function() {
                return user.isSuperuser() === false;
            });
        });
        browser.then(function() {
            done();
        });
    });
    it("Manages admins", function(done) {
        var user = common.server.db.users.findWhere({"sock-key": 'regular1'});
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        var eventUrl = common.URL + "/admin/event/" + event.id;
        var addSelector = "tr[data-user-id='" + user.id + "'] .add-event";
        var removeSelector = "[data-event-id='" + event.id + "'].remove-event";

        browser.get(common.URL);
        browser.mockAuthenticate("superuser1");
        browser.get(common.URL + "/admin/users/")
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.eql(common.URL + "/admin/users/");
        });

        // Pull up the add event modal, and add an event.
        browser.waitForSelector(addSelector);   
        browser.byCss(addSelector).click();
        // Wait for modal to fade in...
        browser.waitForSelector(".modal-body select");
        browser.selectOption(".modal-body select", event.get("title"));
        browser.byCss(".add").click();
        browser.wait(function() {
            return user.isAdminOf(event) === true;
        });

        // Ensure the new admin can access the admin page.
        browser.mockAuthenticate(user.get("sock-key"));
        browser.get(eventUrl);
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.eql(eventUrl);
        });

        // Remove admin-ship for this event.
        browser.mockAuthenticate("superuser1");
        browser.get(common.URL + "/admin/users/");
        browser.waitForSelector(removeSelector);
        browser.byCss(removeSelector).click().then(function() {
            return common.await(function() {
                expect(user.isAdminOf(event)).to.be(false);
            });
        });

        // Ensure the new admin can no longer access the admin page.
        browser.mockAuthenticate(user.get("sock-key"));
        browser.get(eventUrl);
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.eql(common.URL + "/");
            done();
        });
    });
    it("Manages perms", function(done) {
        var user = common.server.db.users.findWhere({"sock-key": 'regular1'});
        var permSelector = "tr[data-user-id='" + user.id + "']" +
                           " input.perm[data-perm='createEvents']";

        expect(user.hasPerm("createEvents")).to.be(false);
        browser.get(common.URL);
        browser.mockAuthenticate("superuser1");
        browser.get(common.URL + "/admin/users/");
        browser.waitForSelector(permSelector);
        browser.byCss(permSelector).click();
        browser.wait(function() {
            if (user.hasPerm("createEvents") === true) {
                return true;
            }
        });
        browser.get(common.URL + "/admin/users/");
        browser.waitForScript("$");
        browser.executeScript('return $("'+permSelector+'").is(":checked");').then(function(checked) {
            expect(checked).to.be(true);
        });
        browser.byCss(permSelector).click();
        browser.wait(function() {
            return user.hasPerm("createEvents") === false;
        });
        browser.get(common.URL + "/admin/users/");
        browser.waitForScript("$");
        browser.executeScript('return $("'+permSelector+'").is(":checked");').then(function(checked) {
            expect(checked).to.be(false);
            done();
        });

    });
    it("Filters users", function(done) {
        browser.get(common.URL);
        browser.mockAuthenticate("superuser1");
        browser.get(common.URL + "/admin/users/");
        browser.waitForSelector("input.filter-name");
        browser.byCss("input.filter-name").sendKeys("Regular");
        browser.byCsss("tr").then(function(els) {
            expect(els.length).to.be(3);
            done();
        });
    });
});

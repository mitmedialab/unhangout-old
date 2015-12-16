var expect = require('expect.js'),
    common = require('./common'),
    mandrill = require("mandrill-api"),
    request = require("superagent"),
    outbox = [];

describe("ADMIN MYEVENTS SELENIUM", function() {
    var browser = null,
        event = null;
    if (process.env.SKIP_SELENIUM_TESTS) {
        return;
    }

    this.timeout(60000); // Extra long timeout for selenium :(

    before(function(done) {
        this.timeout(240000);
        /* Mock Mandrill's API here */
        mandrill.Mandrill = function(apiKey) {
            this.messages = {
                send: function(messageObj) {
                    outbox.push(messageObj.message);
                }
            }
        };
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

    it("Can't access myevents page unauthenticated", function(done) {
        browser.get(common.URL + "/myevents/");
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.not.eql(common.URL + "/myevents/");
            done();
        });
    });

    it("Can't access myevents page if neither a superuser nor an admin of event", 
        function(done) {
        browser.mockAuthenticate("regular1");
        browser.get(common.URL + "/myevents/")
        browser.getPageSource().then(function(source) {
            expect(source.indexOf("Permission denied")).to.not.eql(-1);
            done();
        });
    });

    it("Shows myevents link for admins", function(done) {
        browser.mockAuthenticate("admin1");
        browser.get(common.URL);
        browser.waitForSelector("#user-menu-label");
        browser.byCss("#user-menu-label").click();
        browser.waitForSelector("[href='/logout']")
        browser.byCss("[href='/myevents/']").click();
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.eql(common.URL + "/myevents/");
            done();
        });
    });

    it("Shows myevents link for superusers", function(done) {
        browser.mockAuthenticate("superuser1");
        browser.get(common.URL);
        browser.waitForSelector("#user-menu-label");
        browser.byCss("#user-menu-label").click();
        browser.waitForSelector("[href='/logout']")
        browser.byCss("[href='/myevents/']").click();
        browser.getCurrentUrl().then(function(url) {
            expect(url).to.eql(common.URL + "/myevents/");
            done();
        });
    });

    it("REJECT request if an admin who is not an admin of an event is trying to add admins to it or send admin invite to a user", 
        function(done) {
        var event1 = common.server.db.events.findWhere({shortName: "writers-at-work"});
        var event2 = common.server.db.events.findWhere({shortName: "test-event-2"});
        
        var user1 = common.server.db.users.findWhere({"sock-key": "admin1"});
        var user2 = common.server.db.users.findWhere({"sock-key": "admin2"});

        expect(user1).to.not.be(undefined);
        event1.addAdmin(user1);
        event1.removeAdmin(user2);
        expect(user1.isAdminOf(event1)).to.be(true);
        expect(user2).to.not.be(undefined);
        event2.removeAdmin(user1);
        event2.addAdmin(user2);
        expect(user2.isAdminOf(event1)).to.be(false);

        request.post(common.URL + '/myevents/')
            .set("x-mock-user", "admin1")
            .send({eventId: event2.get("id")}) 
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(400);
        });

        request.post(common.URL + '/myevents/admin-login-invite/')
            .set("x-mock-user", "admin1")
            .send({eventId: event2.get("id")}) 
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(400);
                done();
        }); 

    });

    it("Makes a user an event admin", function(done) {
        //do some event setup for testing this function
        event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        var user1 = common.server.db.users.findWhere({"sock-key": "admin1"});
        user1.set("picture", "https://pbs.twimg.com/profile_images/623000402351517696/NvrZQSuB_400x400.jpg");
        var user2 = common.server.db.users.findWhere({"sock-key": "admin2"});
        user2.set("picture", "https://lh3.googleusercontent.com/-_7XMV9dfvU0/AAAAAAAAAAI/AAAAAAAAAAA/GtrLqI8WLqo/photo.jpg");
        event.addAdmin(user1);
        browser.mockAuthenticate("admin1");
        browser.get(common.URL + "/myevents/");
        browser.byCss(".btn-add-admin").click(); 
        browser.waitForSelector(".filter-email");
        browser.byCss(".filter-email").sendKeys(user2.get("emails")[0].value);
        browser.byCss(".add").click();

        browser.then(function() {
            expect(user2.isAdminOf(event)).to.be(true);
            done();
        });
    });

    it("Sends an admin invite to user if not in the directory", function(done) {
        //do some event setup for testing this function
        event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        var user1 = common.server.db.users.findWhere({"sock-key": "admin1"});
        user1.set("picture", "https://pbs.twimg.com/profile_images/623000402351517696/NvrZQSuB_400x400.jpg");
        event.addAdmin(user1);
        browser.mockAuthenticate("admin1");
        browser.get(common.URL + "/myevents/");
        browser.byCss(".btn-add-admin").click(); 
        browser.waitForSelector(".filter-email");
        browser.byCss(".filter-email").sendKeys("unhangout.developer@gmail.com");
        browser.byCss(".add").click();
        browser.waitForSelector(".btn-send-invite");
        browser.byCss(".btn-send-invite").click().then(function() {
            expect(outbox.length).to.be(1);
            var msg = outbox[0];
            expect(msg.subject).to.eql("unhangout administrator account");
            expect(msg.to[0].email).to.eql("unhangout.developer@gmail.com");
            expect(msg.headers["Reply-To"]).to.eql(user1.get("emails")[0].value);
            // Clear outbox.
            outbox.length = 0;
            done();
        });
    });

    it("Removes an admin", function(done) {
        //do some event setup for testing this function
        event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        var user1 = common.server.db.users.findWhere({"sock-key": "admin1"});
        user1.set("picture", "https://pbs.twimg.com/profile_images/623000402351517696/NvrZQSuB_400x400.jpg");
        var user2 = common.server.db.users.findWhere({"sock-key": "admin2"});
        user2.set("picture", "https://lh3.googleusercontent.com/-_7XMV9dfvU0/AAAAAAAAAAI/AAAAAAAAAAA/GtrLqI8WLqo/photo.jpg");    
        event.addAdmin(user1);
        event.addAdmin(user2);
        browser.mockAuthenticate("admin1");
        browser.get(common.URL + "/myevents/");
        browser.byCss(".btn-remove-admin").click(); 
        var selector = "div[data-id='" + user2.id + "']";
        browser.waitForSelector(selector);
        browser.byCss(selector).click();  
        browser.waitForSelector(".remove");
        browser.byCss(".remove").click();
        browser.waitForSelector(".confirm-removal");

        browser.byCss(".confirm-removal").click().then(function() {
            expect(user2.isAdminOf(event)).to.be(false);
            done();
        });
    });
 
});

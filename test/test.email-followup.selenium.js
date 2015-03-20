var expect = require('expect.js'),
    common = require('./common');
    _ = require('underscore')._,
    sinon = require("sinon"),
    models = require("../lib/server-models"),

describe("SUPERUSER SENDS FOLLOWUP EMAILS (BROWSER)", function() {
    var browser = null;

    var longEnough = "This is a description that is long enough to meet the 100 char length validation for descriptions..."

    if (process.env.SKIP_SELENIUM_TESTS) {
        return;
    }
    this.timeout(60000); // Extra long timeout for selenium :(

    before(function(done) {
        this.timeout(240000);
        common.getSeleniumBrowser(function (theBrowser) {
            browser = theBrowser;
            common.standardSetup(function() {
                event = common.server.db.events.findWhere({shortName: "writers-at-work"});
                done();
            });
        });
    });

    after(function(done) {
        browser.quit().then(function() {
            common.standardShutdown(done);
        });
    });

    function generateUserData(done) {   
        var clock = sinon.useFakeTimers(0, "setTimeout", "clearTimeout", "Date");
        var event = new models.ServerEvent({open: true});
        var session = new models.ServerSession();
        session.save(); // make sure it gets an ID.

        var user_one = common.server.db.users.get(1);
        var user_two = common.server.db.users.get(2);
        var user_three = common.server.db.users.get(3);


        event.get("sessions").add(session);

        session.addConnectedParticipant(user_one);
        session.addConnectedParticipant(user_two);
        session.addConnectedParticipant(user_three);

        var history = {event: {}, sessions: {}};

        history.sessions[session.id] = {"1": {start: 0, total: 1000}, "2": {start: 0, total: 1000}, "3": {start: 0, total: 1000}};

        clock.restore();

        var userData = [];

        _.each(history, function(elapsedTime, userId) {
                        
            //Get the user object for a specific ID 
            var user = common.server.db.users.get(userId);

            // Find all userIDs for users who shared sessions with me at this event.
            var userIds = event.getUserIdsSharingSessionsWith(userId);
            
            // get user objects for the IDs.
            var users = _.map(userIds, function(userId) { 
                return common.server.db.users.get(userId); 
            });

            userData.push({ user: user, users: users });

        });

        return userData; 

    };

    it("Is prompted to login when unauthenticated", function(done) {
        browser.get(common.URL);
        browser.byCss("#login-first-button").click();
        browser.waitForSelector("#login-first-modal h4");
        browser.byCss("#login-first-modal h4").getText().then(function(text) {
            expect(text).to.eql("Please log in!");
            done();
        });
    });

    it("Super User sends followup emails", function(done) {
        
        browser.mockAuthenticate("superuser1");
        //Admin goes to the event page.  Connect a socket to a session.
        browser.get(common.URL + "/event/" + event.id)
        browser.waitForEventReady(event, "superuser1");
        browser.byCss("#submit-contact-info").click(); 
        
        browser.byCss(".admin-button").click();
        browser.waitForSelector("#superuser-page-for-followupemail");
        browser.byCss("#superuser-page-for-followupemail").click();

        var userData = generateUserData(done);
        userData.unshift(null);

        

    });

});

var expect = require('expect.js'),
    common = require('./common');
    _ = require('underscore')._,
    sinon = require("sinon"),
    models = require("../lib/server-models"),
    request = require('superagent'),
    mandrill = require("mandrill-api"),
    outbox = [],

describe("SUPERUSER SENDS FOLLOWUP EMAILS (BROWSER)", function() {
    var browser = null;

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
            common.standardSetup(function() {
                event = common.server.db.events.findWhere({shortName: "writers-at-work"});
                event.set("open", true);
                done();
            });
        });
    });

    after(function(done) {
        browser.quit().then(function() {
            common.standardShutdown(done);
        });
    });

    function generateUserData() {   
        var clock = sinon.useFakeTimers(0, "setTimeout", "clearTimeout", "Date");
        
        var session = event.get("sessions").at(1);
        session.set("approved", true);

        session.set("hangout-url", "http://example.com");
        
        var user_one = common.server.db.users.get(1);
        user_one.set("displayName", "Srishti");
        user_one.set("picture", "http://pldb.media.mit.edu/face/srishti");

        var preferredContact = {};
        preferredContact.emailInfo = "srishakatux@gmail.com";
        preferredContact.twitterHandle = "srishakatux";

        user_one.set("preferredContact", preferredContact)

        var user_two = common.server.db.users.get(2);
        user_two.set("displayName", "Unhangout Developer");
        user_two.set("picture", "https://lh3.googleusercontent.com/-OP7MAxbSCvs/AAAAAAAAAAI/AAAAAAAAAEA/js2MqRDWiJk/photo.jpg");

        var user_three = common.server.db.users.get(3);
        user_three.set("displayName", "Jules");
        user_three.set("picture", "http://lh4.googleusercontent.com/-8NHi4O5-AF0/AAAAAAAAAAI/AAAAAAAAAAA/8kJJNYEwztM/s32-c/photo.jpg");

        var superuser1 = common.server.db.users.findWhere({"sock-key": "superuser1"});

        event.get("connectedUsers").add(user_one);
        event.get("connectedUsers").add(user_two);
        event.get("connectedUsers").add(user_three);
        event.get("connectedUsers").add(superuser1);

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
        //Superuser goes to the event page.  Connect a socket to a session.
        browser.get(common.URL + "/event/" + event.id)
        browser.waitForEventReady(event, "superuser1");
        browser.byCss("#submit-contact-info").click(); 
    
        userData = generateUserData();
        userData.unshift(null);

        request.get(common.URL + '/followup/event/' + event.id + '/participant_1')
            .send({userData: userData, participantIndex: 1})
            .redirects(0)
            .end(function(res) {
                done();
            });

        browser.byCss(".admin-button").click();
        browser.waitForSelector("#superuser-page-for-followupemail");
        browser.byCss("#superuser-page-for-followupemail").click();

        browser.get(common.URL + '/followup/event/' + event.id + '/participant_1');
        
        browser.byCss("#send-email-to-all").click(); 

        browser.waitForSelector("#send-now-button");


        browser.byCss("#send-now-button").click().then(function() {
            generateUserData();

            var noOfUsers = event.get("connectedUsers").length;

            expect(outbox.length).to.be(noOfUsers);

            expect(outbox[0].to[0].email).to.be("regular2@example.com");
            expect(outbox[0].from_email).to.be("noreply@media.mit.edu");
            expect(outbox[0].subject).to.be("Unhangout Event: Followup");

            //expect(outbox[0].html).to.be("Unhangout Event: Followup");

            outbox.length =  0;
            
        });

    });

});

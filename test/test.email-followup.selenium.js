var expect = require('expect.js'),
    common = require('./common');
    _ = require('underscore')._,
    sinon = require("sinon"),
    models = require("../lib/server-models"),
    request = require('superagent'),
    mandrill = require("mandrill-api"),
    conf = require("../lib/options"),
    outbox = [];

describe("SUPERUSER SENDS FOLLOWUP EMAILS (BROWSER)", function() {
    var browser = null;
    var event = null;

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


    // Set up the event with history and user profile settings for testing
    // followup emails
    function prepareEventAndUsers(event) {           
        var session = event.get("sessions").at(1);
        session.set("approved", true);
        //session.set("hangout-url", "http://example.com");

        var users = [];
        /*
        var noShare = common.server.db.users.get(1);
        noShare.set({
          displayName: "NoShareUser",
          picture: "http://pldb.media.mit.edu/face/srishti",
          preferredContact: {},
          noShare: true // to be changed
        });
        users.push(noShare);
        */

        var emailOnly = common.server.db.users.get(2);
        emailOnly.set({
          displayName: "EmailOnlyUser",
          picture: "https://lh3.googleusercontent.com/-OP7MAxbSCvs/AAAAAAAAAAI/AAAAAAAAAEA/js2MqRDWiJk/photo.jpg",
          preferredContact: {
            emailInfo: "unhangout.developer@gmail.com",
          }
        });
        users.push(emailOnly);

        var emailAndTwitter = common.server.db.users.get(3);
        emailAndTwitter.set({ 
          displayName: "EmailAndTwitterUser",
          picture: "http://lh4.googleusercontent.com/-8NHi4O5-AF0/AAAAAAAAAAI/AAAAAAAAAAA/8kJJNYEwztM/s32-c/photo.jpg",
          preferredContact: {
            emailInfo: "jules.schmulz@gmail.com",
            twitterHandle: "JulesSchmulz",
          }
        });
        users.push(emailAndTwitter);

        var linkedInOnly = common.server.db.users.get(4);
        linkedInOnly.set({
          displayName: "LinkedInOnlyUser",
          preferredContact: {
            linkedinURL: "https://www.linkeedin.com/doesanyonereallyusethis"
          }
        });
        users.push(linkedInOnly);

        var superuser1 = common.server.db.users.findWhere({"sock-key": "superuser1"});
        users.push(superuser1);

        // Set up event history such that 
        var history = {event: {}, sessions: {}};
        history.event[noShare.id] = {start: 0, total: 1000};
        history.event[emailOnly.id] = {start: 0, total: 1000};
        history.event[emailAndTwitter.id] = {start: 0, total: 1000};
        history.event[linkedInOnly.id] = {start: 0, total: 1000};
        history.event[superuser1.id] = {start: 0, total: 1000};
        var sessHist = history.sessions[session.id] = {};
        sessHist[noShare.id] = {start: 0, total: 2345};
        sessHist[emailOnly.id] = {start: 0, total: 2345};
        sessHist[linkedInOnly.id] = {start: 0, total: 2345};

        event.set("history", history);
        return users;
    };

    it("Is prompted to login when unauthenticated", function(done) {
        var users = prepareEventAndUsers(event);
        var url = common.URL + "/followup/event/" + event.id + "/participant_0";

        browser.get(url);
        browser.getCurrentUrl().then(function(url) {
          // redirect to login.
          expect(url).to.contain("https://accounts.google.com");
          done();
        });
    });

    it("Super User sends followup emails", function(done) {
        var users = prepareEventAndUsers(event);
        
        browser.mockAuthenticate("superuser1");
        //Superuser goes to the event page.
        browser.get(common.URL + "/event/" + event.id)
        browser.waitForEventReady(event, "superuser1");

        // Click through the contact info dialog.
        browser.waitForSelector("#submit-contact-info");
        browser.byCss("#submit-contact-info").click(); 

        browser.byCss(".admin-button").click();
        browser.waitForSelector("#superuser-page-for-followupemail");
        browser.byCss("#superuser-page-for-followupemail").click();

        browser.get(common.URL + '/followup/event/' + event.id + '/participant_1');
        browser.byCss("#send-email-to-all").click(); 
        browser.waitForSelector("#send-now-button");

        browser.byCss("#send-now-button").click().then(function() {

            expect(outbox.length).to.be(users.length);

            // Ensure that we only have expected recipients, and only one email
            // to each.
            var expectedRecipients = _.map(users, function(u) {
              return u.get("emails")[0].value;
            });
            var actualRecipients = _.map(outbox, function(email) {
              return email.to[0].email;
            });
            expect(expectedRecipients.sort()).to.eql(actualRecipients.sort());

            _.each(outbox, function(email) {
              expect(email.from_email).to.be(conf.UNHANGOUT_SERVER_EMAIL_ADDRESS);
              expect(email.subject).to.be("Following up from the Unhangout");
            });

            // Clear the outbox.
            outbox.length =  0;
            done();
        });

    });

});

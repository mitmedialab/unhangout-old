var expect = require('chai').expect,
    common = require('./common');
    _ = require('underscore')._,
    sinon = require("sinon"),
    models = require("../lib/server-models"),
    request = require('superagent'),
    mandrill = require("mandrill-api"),
    conf = require("../lib/options"),
    outbox = [];

// XXX WARNING: This test uses chai flavored expect, rather than expect.js flavored
// expect, so we can get the custom failure messages that chai supports.

describe("POST EVENT FOLLOWUP EMAIL (BROWSER)", function() {
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


    it("Is prompted to login when unauthenticated", function(done) {
        var users = common.prepareFollowupEventAndUsers(event);
        var url = common.URL + "/followup/event/" + event.id + "/participant_0";

        browser.get(url);
        browser.getCurrentUrl().then(function(url) {
          // redirect to login.
          expect(url).to.contain("https://accounts.google.com");
          done();
        });
    });

    it("Prompts to enter preferredContact when null", function(done) {
        var user = common.server.db.users.get(1);
        user.set("preferredContact", null);
        browser.mockAuthenticate(user.get("sock-key"));
        browser.get(common.URL + "/event/" + event.id);
        browser.waitForSelector("#submit-contact-info").then(function() {
          done();
        });
    });

    it("Prompts to enter preferredContact when empty", function(done) {
        var user = common.server.db.users.get(1);
        user.set("preferredContact", {
          emailInfo: "",
          twitterHandle: "",
          linkedinURL: "",
          noShare: false
        });
        browser.mockAuthenticate(user.get("sock-key"));
        browser.get(common.URL + "/event/" + event.id);
        browser.waitForSelector("#submit-contact-info").then(function() {
          done();
        });
    });

    it("Super User sends followup emails", function(done) {
        var users = common.prepareFollowupEventAndUsers(event);
        
        browser.mockAuthenticate("superuser1");
        //Superuser goes to the event page.
        browser.get(common.URL + "/event/" + event.id)
        browser.waitForEventReady(event, "superuser1");

        // Click through the contact info dialog.
        //browser.waitForSelector("#submit-contact-info");
        //browser.byCss("#submit-contact-info").click(); 

        browser.byCss(".admin-button").click();
        browser.waitForSelector("#superuser-page-for-followupemail");
        browser.byCss("#superuser-page-for-followupemail").click();

        browser.get(common.URL + '/followup/event/' + event.id + '/participant_1');
        browser.byCss("#send-email-to-all").click(); 
        browser.waitForSelector("#send-now-button");

        browser.byCss("#send-now-button").click().then(function() {

            expect(outbox.length).to.equal(_.size(users));

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
              expect(email.from_email).to.equal(conf.UNHANGOUT_SERVER_EMAIL_ADDRESS);
              expect(email.subject).to.equal("Following up from the Unhangout");

              // Ensure that preferredContact info is respected.
              var recipient = _.find(users, function(u) {
                return u.get("emails")[0].value === email.to[0].email;
              });
              var cohort = event.getUserIdsSharingSessionsWith(recipient.id);
              _.each(cohort, function(userId) {
                var user = _.find(users, function(u) { return u.id === userId; });
                var pc = user.get("preferredContact");
                var emailIndex = email.html.indexOf(pc.emailInfo);
                var twitterIndex = email.html.indexOf(pc.twitterHandle);
                var linkedinIndex = email.html.indexOf(pc.linkedinURL);
                var nameIndex = email.html.indexOf(user.get("displayName"));
                var sharing = !pc.noShare;
                
                if (sharing) {
                  expect(nameIndex).to.not.equal(-1, "Name not found: " + user.get("displayName"));
                } else {
                  expect(nameIndex).to.equal(-1, "unshared name found: " + user.get("displayName"));
                }
                if (pc.emailInfo) {
                  if (sharing) {
                    expect(emailIndex).to.not.equal(-1, "emailIndex not found: " + pc.emailInfo);
                  } else {
                    expect(emailIndex).to.equal(-1, "unshared emailIndex found: " + pc.emailInfo);
                  }
                }
                if (pc.twitterHandle) {
                  if (sharing) {
                    expect(twitterIndex).to.not.equal(-1, "twitterHandle not found: " + pc.twitterHandle);
                  } else {
                    expect(twitterIndex).to.equal(-1, "unshared twitterHandle found: " + pc.twitterHandle);
                  }
                }
                if (pc.linkedinURL) {
                  if (sharing) {
                    expect(linkedinIndex).to.not.equal(-1, "twitterHandle not found: " + pc.linkedinURL);
                  } else {
                    expect(linkedinIndex).to.equal(-1, "unshared twitterHandle found: " + pc.linkedinURL);
                  }
                }
              });
            });

            // Clear the outbox.
            outbox.length =  0;
            done();
        });

    });

});

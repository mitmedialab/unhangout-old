var server = require('../lib/unhangout-server'),
    expect = require('expect.js'),
    _ = require('underscore')._,
    request = require('superagent'),
    conf = require('../lib/options'),
    common = require('./common');

var sock;
var session;

var longEnough = "This is a description that is long enough to meet the 100 char length validation for descriptions..."
var validBody = {eventTitle: "This is fun", eventDescription: longEnough};

describe("EMAIL REQUEST FOR ADMIN", function() {
    beforeEach(function(done) {
        common.standardSetup(function() {
            common.startEmailServer(done);
        });
    });
    afterEach(function(done) {
        common.standardShutdown(function() {
            common.stopEmailServer(done);
        });
    });

    function postSignupRequest(user, body, callback) {
        request.post("http://localhost:7777/admin-request/")
            .set("x-mock-user", user)
            .send(body)
            .redirects(0)
            .end(function(res) {
                // Run this on "next-tick" so that the SMTP server has time to
                // receive the message.
                setTimeout(function() { callback(res) }, 1);
            });
    };
    it("Rejects unauthenticated requests", function(done) {
        request.post("http://localhost:7777/admin-request/")
            .send(validBody)
            .end(function(res) {
                expect(res.status).to.be(403);
                done();
            });
    });

    it("Sends email on well-formed request", function(done) {
        postSignupRequest("regular1", validBody, function(res) {
            expect(res.status).to.be(200);
            // Next tick..
            setTimeout(function() {
                expect(common.outbox.length).to.be(1);
                var msg = common.outbox[0];
                expect(msg.to).to.eql(_.map(conf.UNHANGOUT_MANAGERS, common.recipientify));
                expect(msg.from).to.eql([common.recipientify(conf.UNHANGOUT_SERVER_EMAIL_ADDRESS)]);
                expect(msg.subject).to.eql("Unhangout: Request for Admin Account");
                expect(msg.html.indexOf(validBody.eventTitle)).to.not.eql(-1); 
                expect(msg.html.indexOf(validBody.eventDescription)).to.not.eql(-1);
                // Clear the outbox.
                common.outbox.length = 0;
                done();
            }, 1);
        });
    });

    it("Rejects missing title", function(done) {
        postSignupRequest("regular1", {eventDescription: longEnough}, function(res) {
            expect(res.status).to.be(400);
            expect(common.outbox.length).to.be(0);
            done();
        });
    });
    it("Rejects too short title", function(done) {
        postSignupRequest("regular1", {eventTitle: "a", eventDescription: longEnough}, function(res) {
            expect(res.status).to.be(400);
            expect(common.outbox.length).to.be(0);
            done();
        });
    });
    it("Rejects missing description", function(done) {
        postSignupRequest("regular1", {eventTitle: validBody.title}, function(res) {
            expect(res.status).to.be(400);
            expect(common.outbox.length).to.be(0);
            done();
        });
    });
    it("Rejects too short description", function(done) {
        postSignupRequest("regular1", {eventTitle: validBody.title, eventDescription: "a"}, function(res) {
            expect(res.status).to.be(400);
            expect(common.outbox.length).to.be(0);
            done();
        });
    });
});

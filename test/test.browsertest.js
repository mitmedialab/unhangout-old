var server = require('../lib/unhangout-server'),
    expect = require('expect.js'),
    _ = require('underscore')._,
    request = require('superagent'),
    common = require('./common');

var session;

describe("HTTP ADMIN USERS API", function() {
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

    var browserTestMatch = function(auth, regex, done) {
        var req = request.get(common.URL + "/browsertest/")
        if (auth) {
            req.set("x-mock-user", auth);
        }
        req.end(function(res) {
            expect(res.status).to.be(200);
            expect(res.text).to.match(regex);
            done();
        });
    }

    it("Prompts to login when not logged in", function(done) {
        browserTestMatch(null, 
          /.*First things first: you need to be.*Logged(.|\n)*In.*/,
          done);
    });
    it("Shows when logged in", function(done) {
        browserTestMatch("regular1", /.*Logged in as regular1@example\.com.*/, done);
    });
    it("Notices when account lacks G+", function(done) {
        browserTestMatch("regular1",
          /.*It looks like you haven't connected your Google account.*/,
          done);
    });
    it("Notices when account has G+", function(done) {
        var user = common.server.db.users.findWhere({"sock-key": "regular1"});
        user.set("link", "https://plus.google.com/_/asdf");
        browserTestMatch("regular1",
          /.*Google Plus account looks good.*/,
          done);
    });
    it("Fetches / creates test session", function(done) {
        var user = common.server.db.users.findWhere({"sock-key": "regular1"});
        user.set("link", "https://plus.google.com/_/asdf");
        var req = request.get(common.URL + "/browsertest/")
            .set("x-mock-user", "regular1")
            .end(function(res) {
                expect(res.status).to.be(200);
                var session = common.server.db.permalinkSessions.findWhere({
                    shortCode: "test0"});
                expect(res.text).to.match(
                    new RegExp(".*href='/session/" + session.get("session-key") + "'.*")
                );
                done();
            });
    });
    it("Accepts reports and delivers email", function(done) {
        var user = common.server.db.users.findWhere({"sock-key": "regular1"});
        user.set("link", "https://plus.google.com/_/asdf");
        var _json = {"this": "that"};
        user.set("_json", _json);
        var data = {
            problem: "It doesn't work",
            browser: "My internets",
            googleacct: "no"
        };
        var req = request.post(common.URL + "/browsertest/")
            .set("x-mock-user", "regular1")
            .send(data)
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(302);
                common.await(function() {
                    return common.outbox.length == 1;
                }).then(function() {
                    var msg = common.outbox[0];
                    expect(msg.text).to.contain(data.problem);
                    expect(msg.text).to.contain(data.browser);
                    expect(msg.text).to.contain(data.googleacct);
                    expect(msg.text).to.contain(JSON.stringify(_json, null, 2));
                    expect(msg.text).to.contain(user.get("emails")[0].value);
                }).then(function() {
                    done();
                });
            });
    });
});

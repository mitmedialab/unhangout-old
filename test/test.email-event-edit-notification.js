var server = require('../lib/unhangout-server'),
    expect = require('expect.js'),
    Promise = require("bluebird"),
    sinon = require("sinon"),
    _ = require('underscore')._,
    request = require('superagent'),
    conf = require('../lib/options'),
    common = require('./common');

var origDelay;

describe("EMAIL REQUEST FOR ADMIN", function() {
    beforeEach(function(done) {
        common.standardSetup(function() {
            origDelay = common.server.options.EVENT_EDIT_NOTIFICATION_DELAY;
            common.server.options.EVENT_EDIT_NOTIFICATION_DELAY = 5;
            common.startEmailServer(done);
        });
    });
    afterEach(function(done) {
        common.standardShutdown(function() {
            common.server.options.EVENT_EDIT_NOTIFICATION_DELAY = origDelay;
            common.stopEmailServer(done);
        });
    });

    function postEventEdit(user, params) {
        return new Promise(function(resolve, reject) {
            request.post("http://localhost:7777/admin/event/" + (params.id || "new"))
                .set("x-mock-user", user)
                .send(params)
                .redirects(0)
                .end(function(res) {
                    if (res.status != 302) {
                        return reject(new Error("Expected 302, got " + res.status));
                    }
                    // next tick.
                    setTimeout(function() { resolve(res); }, 0);
                });
        });
    };

    it("Sends email on edit", function(done) {
        var event = common.server.db.events.get(1);
        expect(common.outbox.length).to.be(0);
        postEventEdit("admin1", event.toJSON()).then(function(res) {
            expect(common.outbox.length).to.be(0);
            return common.await(function() { return common.outbox.length == 1; })
        }).then(function() {
            expect(common.outbox.length).to.be(1);
            var msg = common.outbox.shift();
            expect(msg.to).to.eql(_.map(conf.UNHANGOUT_MANAGERS, common.recipientify));
            expect(msg.subject).to.eql("Unhangout: Event 1 edited");
            _.each([
               "title", "organizer", "description", "welcomeMessage",
               "shortName", "dateAndTime", "timeZoneValue"
            ], function(key) {
                expect(
                    msg.html.indexOf(_.escape(event.get(key)))
                ).to.not.eql(-1);
            });
            done();
        }).catch(function(err) {
            done(err);
        });
    });

    it("Throttles multiple edits", function(done) {
        var event = common.server.db.events.get(1);
        var origTitle = event.get("title");
        expect(common.outbox.length).to.be(0);
        Promise.map([1, 2, 3, 4, 5], function(val) {
            var json = event.toJSON();
            // append the number..
            json.title = json.title.substring(0, json.title.length - 1) + val;
            return postEventEdit("admin1", json);
        }).then(function() {
            expect(common.outbox.length).to.be(0);
            return common.await(function() { return common.outbox.length > 0; });
        }).then(function() {
            expect(common.outbox.length).to.be(1);
            var msg = common.outbox.shift();
            expect(msg.to).to.eql(_.map(conf.UNHANGOUT_MANAGERS, common.recipientify));
            expect(msg.subject).to.eql("Unhangout: Event 1 edited");
            var expectedTitle = origTitle.substring(0, origTitle.length - 1) + 5;
            expect(msg.html.indexOf(_.escape(expectedTitle))).to.not.eql(-1);
            done();
        }).catch(function(err) {
            done(err);
        });
    });

    it("Notifies after event creation with new ID", function(done) {
        postEventEdit("superuser1", {
            title: "New Event",
            description: "Description",
            shortName: "shawty"
        }).then(function() {
            return common.await(function() { return common.outbox.length == 1; });
        }).then(function() {
            expect(common.outbox.length).to.be(1);
            var msg = common.outbox.shift();
            var match = /Unhangout: Event (\d+) edited/.exec(msg.subject);
            expect(match).to.not.be(null);
            var event = common.server.db.events.get(parseInt(match[1]));
            expect(event.get("title")).to.be("New Event");
            done();
        }).catch(function(err) {
            done(err);
        });
    });

});

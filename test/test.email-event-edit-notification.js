var server = require('../lib/unhangout-server'),
    expect = require('expect.js'),
    Promise = require("bluebird"),
    _ = require('underscore')._,
    request = require('superagent'),
    conf = require('../lib/options'),
    utils = require("../lib/utils"),
    models = require("../lib/server-models"),
    common = require('./common');

var origDelay;

describe("EMAIL EVENT EDIT NOTIFICATION", function() {
    beforeEach(function(done) {
        common.standardSetup(function() {
            origDelay = common.server.options.EVENT_EDIT_NOTIFICATION_DELAY;
            common.server.options.EVENT_EDIT_NOTIFICATION_DELAY = 100;
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
            request.post(common.URL + "/admin/event/" + (params.id || "new"))
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

    it("Sends no email on text-only edit", function(done) {
        var event = common.server.db.events.get(1);
        expect(common.outbox.length).to.be(0);
        var warnings = utils.getEventSanitizationWarnings(event);
        expect(_.size(warnings)).to.be(0);
        postEventEdit("admin1", event.toJSON()).then(function(res) {
            expect(common.outbox.length).to.be(0);
            setTimeout(function() {
                expect(common.outbox.length).to.be(0);
                done();
            }, 200); // 200ms ought to be long enough for email to process..
        }).catch(function(err) { done(err); });

    });

    it("Sends email on edit containing worrisome HTML", function(done) {
        var event = common.server.db.events.get(1);
        event.set("description",
                  "<style>body { color: pink; }</style>" + event.get("description"));
        var warnings = utils.getEventSanitizationWarnings(event);
        expect(_.size(warnings)).to.be(1);
        expect(common.outbox.length).to.be(0);

        postEventEdit("admin1", event.toJSON()).then(function(res) {
            return common.await(function() { return common.outbox.length == 1; })
        }).then(function() {
            expect(common.outbox.length).to.be(1);
            var msg = common.outbox.shift();
            expect(msg.to).to.eql(_.map(conf.UNHANGOUT_MANAGERS, common.recipientify));
            expect(msg.subject).to.eql("Unhangout: Event 1 edited");
            _.each(["Risky Tags", "style", "color: pink"], function(txt) {
                expect(msg.html.indexOf(txt)).to.not.eql(-1);
            });
            done();
        }).catch(function(err) {
            done(err);
        });
    });

    it("Throttles multiple edits", function(done) {
        var event = common.server.db.events.get(1);
        event.set("description",
                  "<style>body{color:pink}</style>" + event.get("description"));
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
            description: "Description <style>body{color: worrisome}</style>",
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

    it("Issues warnings for all relevant fields", function() {
        function checkWarnings(props, expected) {
            expect(
                utils.getEventSanitizationWarnings(new models.ServerEvent(props))
            ).to.eql(
                expected
            );
        };
        var fields = ["organizer", "description", "overflowMessage"];
        checkWarnings({
            organizer: "test",
            description: "test",
            overflowMessage: "test"
        }, {});

        // mixed content warnings
        fields.forEach(function(field) {
            var props = {};
            props[field] = "test <img src='http://i.imgur.com/E4p6tht.jpg' />";
            var errors = {"mixed content": {}};
            errors["mixed content"][field] = [{
                tagName: "img",
                attribName: "src",
                change: "removed",
                oldValue: "http://i.imgur.com/E4p6tht.jpg",
                newValue: null
            }];
            checkWarnings(props, errors);
        });

        // Unsafe tag warnings
        fields.forEach(function(field) {
            var props = {};
            props[field] = "test <style>body{color:pink}</style>";
            var errors = {"risky tag": {}};
            errors["risky tag"][field] = [{
                tagName: "style",
                change: "removed",
                innerHTML: "body{color:pink}"
            }];
            checkWarnings(props, errors);
        });

        // Unsafe attribute warnings
        fields.forEach(function(field) {
            var props = {};
            props[field] = "test <span style='color: pink;'>oh no</style>";
            var errors = {"risky attribute": {}};
            errors["risky attribute"][field] = [{
                tagName: "span",
                attribName: "style",
                change: "removed",
                oldValue: "color: pink;",
                newValue: null
            }];
            checkWarnings(props, errors);
        });

        // Shadowable attribute warnings
        fields.forEach(function(field) {
            var props = {};
            props[field] = "test <span class='login'>oh my</span>";
            var errors = {"shadowable attribute": {}};
            errors["shadowable attribute"][field] = [{
                change: "changed",
                tagName: "span",
                attribName: "class",
                oldValue: "login",
                newValue: "userhtml-login"
            }];
            checkWarnings(props, errors);
        });

        // Multiple warnings
        var props = {
            "organizer": "<style>body{color:pink}</style>",
            "description": "<span class='login'>oh my</span><img src='http://i.imgur.com/E4p6tht.jpg'>",
            "overflowMessage": "<span style='font-family: ugly;'>oy</span>"
        };
        var errors = {
            "risky tag": {organizer: [{
                change: "removed", tagName: "style",
                innerHTML: "body{color:pink}"
            }]},
            "shadowable attribute": {description: [{
                change: "changed", tagName: "span", attribName: "class",
                oldValue: "login", newValue: "userhtml-login"
            }]},
            "mixed content": {description: [{
                change: "removed", tagName: "img", attribName: "src",
                oldValue: "http://i.imgur.com/E4p6tht.jpg", newValue: null
            }]},
            "risky attribute": {overflowMessage: [{
                change: "removed", tagName: "span", attribName: "style",
                oldValue: "font-family: ugly;", newValue: null
            }]}
        };
        checkWarnings(props, errors);
    });
});

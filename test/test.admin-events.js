var server = require('../lib/unhangout-server'),
    expect = require('expect.js'),
    async = require("async"),
    _ = require('underscore')._,
    request = require('superagent'),
    common = require('./common');

var sock;
var session;

describe('HTTP ADMIN EVENTS API', function() {
    afterEach(common.standardShutdown);
    beforeEach(common.standardSetup);

    function expectError(res, msg) {
        expect(res.status).to.be(200);
        expect(
            res.text.indexOf("<span class='help-inline'>" + msg + "</span>")
        ).to.not.eql(-1);
    }

    it("/admin/event/new allows GET from allowed users", function(done) {
        // Set up a user with "createEvents" permission
        var user = common.server.db.users.findWhere({"sock-key": "regular1"});
        user.setPerm("createEvents", true);

        async.map(["superuser1", "regular1"], function(user, done) {
            request.get("http://localhost:7777/admin/event/new")
                .set("x-mock-user", user)
                .redirects(0)
                .end(function(res) {
                    expect(res.status).to.be(200);
                    done();
                });
        }, function(err) {
            done();
        });
    });

    it("/admin/event/new denies GET from users without permission", function(done) {
        // Set up a user with "createEvents" permission
        var user = common.server.db.users.findWhere({"sock-key": "regular1"});
        user.setPerm("createEvents", false);
        expect(common.server.db.users.findWhere({"sock-key": "admin1"}).hasPerm("createEvents")
              ).to.be(false);

        async.map(["admin1", "regular1"], function(user, done) {
            request.get("http://localhost:7777/admin/event/new")
                .set("x-mock-user", user)
                .redirects(0)
                .end(function(res) {
                    expect(res.status).to.be(401);
                    done();
                });
        }, function(err) {
            done();
        });
    });

    it('/admin/event/new rejects POST from non-admins', function(done) {
        expect(common.server.db.users.findWhere(
            {'sock-key': 'regular1'}).hasPerm("createEvents")).to.be(false);
        request.post('http://localhost:7777/admin/event/new')
            .set("x-mock-user", "regular1")
            .send({title:"Test Event", description:"Description of the test event."})
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(401);
                done();
            });
    });


    it('/admin/event/new accepts POST from superuser', function(done) {
        request.post('http://localhost:7777/admin/event/new')
            .set("x-mock-user", "superuser1")
            .send({title:"Test Event 1234", description:"Description of the test event."})
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(302);
                var evt = common.server.db.events.findWhere({title: "Test Event 1234"});
                expect(evt.get('title')).to.be("Test Event 1234");
                expect(evt.get("description")).to.be("Description of the test event.");
                expect(res.header['location']).to.be("/event/" + evt.id);
                // Superusers don't get added as admins automatically.
                expect(evt.get("admins").length).to.be(0);
                done();
            });
    });

    it('/admin/event/new accepts POST from users with permission', function(done) {
        var user = common.server.db.users.findWhere({"sock-key": "admin1"});
        user.setPerm("createEvents", true);

        request.post('http://localhost:7777/admin/event/new')
            .set("x-mock-user", "admin1")
            .send({title:"Test Event 2345", description:"Description of the test event."})
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(302);
                var evt = common.server.db.events.findWhere({title:"Test Event 2345"});
                expect(evt.get("title")).to.be("Test Event 2345");
                expect(evt.get("description")).to.be("Description of the test event.");
                expect(evt.get("admins").length).to.be(1);
                expect(evt.get("admins")[0].id).to.eql(user.id);

                expect(res.header['location']).to.be("/event/" + evt.id);

                done();
            });
    });

    it('/admin/event/new errors POST missing required params', function(done) {
        // title is missing
        request.post('http://localhost:7777/admin/event/new')
            .set("x-mock-user", "superuser1")
            .send({description:"Description of the test event."})
            .redirects(0)
            .end(function(res) {
                expectError(res, "A title is required.");
                done();
            });
    });

    it('/admin/event/new errors POST with duplicate event shortNames', function(done) {
        var evt = common.server.db.events.at(0);
        request.post("http://localhost:7777/admin/event/new")
            .set("x-mock-user", "superuser1")
            .send({description: "Fun times", title: "Great",
                  shortName: evt.get("shortName")})
            .redirects(0)
            .end(function(res) {
                expectError(res, "That name is already taken.");
                done();
            });
    });

    it('/admin/event/new errors POST with tricky shortname chars', function(done) {
        request.post("http://localhost:7777/admin/event/new")
            .set("x-mock-user", "superuser1")
            .send({description: "Fun times", title: "Great",
                  shortName: "oh/kay"})
            .redirects(0)
            .end(function(res) {
                expectError(res, "Only letters, numbers, - and _ allowed in event URLs.");
                done();
            });
    });

    it('/admin/event/new errors POST with number-only shortnames', function(done) {
        request.post("http://localhost:7777/admin/event/new")
            .set("x-mock-user", "superuser1")
            .send({description: "Fun times", title: "Great",
                  shortName: "12345"})
            .redirects(0)
            .end(function(res) {
                expectError(res, "At least one letter is required.");
                done();
            });
    });

    it('/admin/event/new errors POST with invalid dates', function(done) {
        var params = {
            title: "Excellent",
            description: "Party time",
            shortName: "unique-city",
            dateAndTime: "wat",
            timeZoneValue: "America/New_York"
        }
        request.post("http://localhost:7777/admin/event/new")
            .set("x-mock-user", "superuser1")
            .send(params)
            .redirects(0)
            .end(function(res) {
                expectError(res, "Invalid date or timezone.");
                done();
            });
    });

    it('/admin/event/new errors POST with invalid timezones', function(done) {
        var params = {
            title: "Excellent",
            description: "Party time",
            shortName: "unique-city",
            dateAndTime: "Tuesday, Nov 11, 2014 11:32 pm",
            timeZoneValue: "wat"
        };
        request.post("http://localhost:7777/admin/event/new")
            .set("x-mock-user", "superuser1")
            .send(params)
            .redirects(0)
            .end(function(res) {
                expectError(res, "Invalid date or timezone.");
                done();
            });
    });

    it('/admin/event/new errors POST with invalid overflowUserCap', function(done) {
        async.map(["-1", "asdf"], function(overflowUserCap, done) {
            var params = {
                title: "Excellent",
                description: "Party time",
                shortName: "unique-city",
                dateAndTime: "Tuesday, Nov 11, 2014 11:32 pm",
                timeZoneValue: "America/New_York",
                overflowUserCap: overflowUserCap
            };
            request.post("http://localhost:7777/admin/event/new")
                .set("x-mock-user", "superuser1")
                .send(params)
                .redirects(0)
                .end(function(res) {
                    expectError(res, "Must be a number greater than or equal to zero.");
                    done();
                });
        }, function() { done(); });
    });

    it('/admin/event/new POST ignores overflowUserCap from non-superusers', function(done) {
        var user = common.server.db.users.findWhere({"sock-key": "admin1"});
        user.setPerm("createEvents", true);
        var params = {
            title: "Excellent",
            description: "Party time",
            shortName: "unique-city",
            dateAndTime: "Tuesday, Nov 11, 2014 11:32 pm",
            timeZoneValue: "America/New_York",
            overflowUserCap: "10"
        };
        request.post("http://localhost:7777/admin/event/new")
            .set("x-mock-user", "admin1")
            .send(params)
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(302);
                var evt = common.server.db.events.findWhere({"title": "Excellent"});
                expect(evt.get("overflowUserCap")).to.be(200);
                done();
            });
    });

    it("/admin/event/new GET shows overflowUserCap to superusers", function(done) {
        request.get("http://localhost:7777/admin/event/new")
            .set("x-mock-user", "superuser1")
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(200);
                expect(/name=.overflowUserCap./.test(res.text)).to.be(true);
                done();
            });
    });

    it("/admin/event/new GET hides overflowUserCap from non-superusers", function(done) {
        var user = common.server.db.users.findWhere({"sock-key": "admin1"});
        user.setPerm("createEvents", true);
        expect(user.isSuperuser()).to.be(false);
        request.get("http://localhost:7777/admin/event/new")
            .set("x-mock-user", "admin1")
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(200);
                expect(/name=.overflowUserCap./.test(res.text)).to.be(false);
                done();
            });
    });

    it("/admin/event/new POST treats 'null' string as an empty date", function(done) {
        var params = {
            title: "Excellent",
            shortName: 'unique-city',
            description: "Party time",
            dateAndTime: "",
            timeZoneValue: "America/Denver"
        };
        request.post("http://localhost:7777/admin/event/new")
            .set("x-mock-user", "superuser1")
            .send(params)
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(302);
                var evt = common.server.db.events.findWhere({shortName: "unique-city"});
                expect(evt).to.not.be(undefined);
                expect(evt.get("dateAndTime")).to.be(null);
                expect(evt.get("timeZoneValue")).to.be(null);
                expect(evt.formatDate()).to.eql("");
                done();
            });
    });

    it("/admin/event/new POST accepts valid times and zones", function(done) {
        var params = {
            title: "Excellent",
            description: "Party time",
            shortName: "unique-city",
            dateAndTime: "Tuesday, Nov 11, 2014 11:32 pm",
            timeZoneValue: "America/New_York"
        };
        request.post("http://localhost:7777/admin/event/new")
            .set("x-mock-user", "superuser1")
            .send(params)
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(302);
                var evt = common.server.db.events.findWhere({shortName: "unique-city"});
                expect(evt).to.not.be(undefined);
                expect(evt.get("dateAndTime")).to.eql("2014-11-12T04:32:00+00:00");
                expect(evt.get("timeZoneValue")).to.eql("America/New_York");
                expect(evt.formatDate()).to.eql("Tuesday Nov 11, 2014 11:32 pm EST");
                done();

            });
    });

    it('/admin/event/new POST redirects to event page on success', function(done) {
        request.post('http://localhost:7777/admin/event/new')
            .set("x-mock-user", "superuser1")
            .send({title:"Test Event", description:"Description of the test event."})
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(302);
                expect(/\/event\/\d+/.test(res.header['location'])).to.be(true);
                done();
            });
    });

    it('/admin/event/new, /admin/event/:id POST sets all valid params', function(done) {
        var params = {
            title: "My title",
            organizer: "My organizer",
            shortName: "my-shortName",
            dateAndTime: "Tuesday, Nov 11, 2014 11:32 pm",
            timeZoneValue: "America/Denver",
            welcomeMessage: "Wilkommen",
            description: "My description",
            overflowMessage: "Oh noes we's overfloes"
        }
        request.post('http://localhost:7777/admin/event/new')
            .set("x-mock-user", "superuser1")
            .send(params)
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(302);
                var evt = common.server.db.events.findWhere({shortName: "my-shortName"});
                expect(evt).to.not.be(undefined);
                var att = evt.attributes;
                expect(att.title).to.eql("My title");
                expect(att.organizer).to.eql("My organizer");
                expect(att.shortName).to.eql("my-shortName");
                expect(att.dateAndTime).to.eql("2014-11-12T06:32:00+00:00");
                expect(att.timeZoneValue).to.eql("America/Denver");
                expect(att.welcomeMessage).to.eql("Wilkommen");
                expect(att.description).to.eql("My description");
                expect(att.overflowMessage).to.eql("Oh noes we's overfloes");
                //
                // Should also clear all optional params.
                //
                request.post('http://localhost:7777/admin/event/' + evt.id)
                    .set("x-mock-user", "superuser1")
                    .send({
                        title: "My title",
                        organizer: "",
                        shortName: "",
                        dateAndTime: "",
                        welcomeMessage: "",
                        description: "My description",
                        overflowMessage: ""
                    })
                    .end(function(res) {
                        expect(res.status).to.be(200);
                        evt = common.server.db.events.findWhere({title: "My title"});
                        att = evt.attributes;
                        expect(att.title).to.eql("My title");
                        expect(att.organizer).to.eql("");
                        expect(att.shortName).to.eql(null);
                        expect(att.dateAndTime).to.eql(null);
                        expect(att.welcomeMessage).to.eql("");
                        expect(att.description).to.eql("My description");
                        expect(att.overflowMessage).to.eql("");
                        done();
                    });
            });
    });


    it('/admin/event/:id rejects POST from non-admins', function(done) {
        request.post('http://localhost:7777/admin/event/1')
            .set("x-mock-user", "regular1")
            .send({title:"Test Event", description:"Description of the test event."})
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(302);
                expect(res.header['location']).to.be("/");
                done();
            });
    });

    it('/admin/event/:id rejects POST from admins of other events who don\'t admin this one', function(done) {
        // make sure they have `create event` and that's not why we reject them.
        var user = common.server.db.users.findWhere({"sock-key": "admin2"});
        user.setPerm("createEvents", true);

        request.post('http://localhost:7777/admin/event/1')
            .set("x-mock-user", "admin2")
            .send({title:"Test Event", description:"Description of the test event."})
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(302);
                expect(res.header['location']).to.be("/");
                done();
            });
    });

    it('/admin/event/:id accepts POST from admin', function(done) {
        var user = common.server.db.users.findWhere({"sock-key": "admin1"});
        var evt = common.server.db.events.findWhere({shortName: "writers-at-work"});
        var sessions = evt.get("sessions"); 
        // the user should be an admin of this event..
        expect(evt.userIsAdmin(user)).to.be(true);
        // .. but they shouldn't need createEvents permission.
        user.setPerm("createEvents", false);

        request.post('http://localhost:7777/admin/event/1')
            .set("x-mock-user", "admin1")
            .send({title:"Test Event", description:"Description of the test event."})
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(302);
                var evt = common.server.db.events.get(1);
                expect(evt.get("sessions").length).to.eql(sessions.length);
                expect(evt.get("title")).to.be("Test Event");
                expect(evt.get("description")).to.be("Description of the test event.");
                done();
            });
    });

    it('/admin/event/:id accepts POST from superuser', function(done) {
        request.post('http://localhost:7777/admin/event/1')
            .set("x-mock-user", "superuser1")
            .send({title:"Test Event", description:"Description of the test event."})
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(302);
                var evt = common.server.db.events.get(1);
                expect(evt.get("title")).to.be("Test Event");
                expect(evt.get("description")).to.be("Description of the test event.");
                done();
            });
    });
});

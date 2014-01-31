var server = require('../lib/unhangout-server'),
	expect = require('expect.js'),
	_ = require('underscore')._,
	request = require('superagent'),
    common = require('./common');

var sock;
var session;

describe('HTTP ADMIN EVENTS API', function() {
	afterEach(common.standardShutdown);
    beforeEach(common.standardSetup);

    it("allows GET from allowed users", function(done) {
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
    it("denies GET from users without permission", function(done) {
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

	describe('/admin/event/new (non-admin)', function() {
		it('should reject well-formed requests from those without permission', function(done) {
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
	});

	describe('/admin/event/new (admin)', function() {

		it('should accept well-formed creation request from superuser', function(done) {
			request.post('http://localhost:7777/admin/event/new')
                .set("x-mock-user", "superuser1")
				.send({title:"Test Event", description:"Description of the test event."})
				.redirects(0)
				.end(function(res) {
                    expect(res.status).to.be(302);
                    var evt = common.server.db.events.at(common.server.db.events.length-1);
                    expect(evt.get('title')).to.be("Test Event");
                    expect(evt.get("description")).to.be("Description of the test event.");
                    expect(res.header['location']).to.be("/event/" + evt.id);
                    // Superusers don't get added as admins automatically.
                    expect(evt.get("admins").length).to.be(0);
					done();
				});
		});
		it('should accept well-formed creation request from users with perms', function(done) {
            var user = common.server.db.users.findWhere({"sock-key": "admin1"});
            user.setPerm("createEvents", true);

			request.post('http://localhost:7777/admin/event/new')
                .set("x-mock-user", "admin1")
				.send({title:"Test Event", description:"Description of the test event."})
				.redirects(0)
				.end(function(res) {
                    expect(res.status).to.be(302);
                    var evt = common.server.db.events.at(common.server.db.events.length-1);
                    expect(evt.get("title")).to.be("Test Event");
                    expect(evt.get("description")).to.be("Description of the test event.");
                    expect(evt.get("admins").length).to.be(1);
                    expect(evt.get("admins")[0].id).to.eql(user.id);

					expect(res.header['location']).to.be("/event/" + evt.id);

					done();
				});
		});

		it('should reject requests that are missing required parameters', function(done) {
			// title is missing
			request.post('http://localhost:7777/admin/event/new')
                .set("x-mock-user", "superuser1")
				.send({description:"Description of the test event."})
				.redirects(0)
				.end(function(res) {
                    expect(res.text).to.eql("Missing parameter `title`.");
                    expect(res.status).to.be(400);
					done();
				});
		});

        it('should reject duplicate event shortNames', function(done) {
            var evt = common.server.db.events.at(0);
            request.post("http://localhost:7777/admin/event/new")
                .set("x-mock-user", "superuser1")
                .send({description: "Fun times", title: "Great",
                      shortName: evt.get("shortName")})
                .redirects(0)
                .end(function(res) {
                    expect(res.status).to.be(400);
                    expect(JSON.parse(res.text)).to.eql({
                        "shortName": "That name is already taken."
                    })
                    done();
                });
        });
        it('should reject tricky shortname characters', function(done) {
            request.post("http://localhost:7777/admin/event/new")
                .set("x-mock-user", "superuser1")
                .send({description: "Fun times", title: "Great",
                      shortName: "oh/kay"})
                .redirects(0)
                .end(function(res) {
                    expect(res.status).to.be(400);
                    expect(JSON.parse(res.text)).to.eql({
                        "shortName": "Only letters, numbers, - and _ allowed in event URLs."
                    })
                    done();
                });
        });

        it('should reject invalid dates', function(done) {
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
                    expect(res.status).to.be(400);
                    expect(JSON.parse(res.text)).to.eql({
                        "dateAndTime": "Invalid date or timezone."
                    })
                    done();
                });
        });

        it('should reject invalid timezones', function(done) {
            var params = {
                title: "Excellent",
                description: "Party time",
                shortName: "unique-city",
                dateAndTime: "2014-11-11T11:11:11",
                timeZoneValue: "wat"
            };
            request.post("http://localhost:7777/admin/event/new")
                .set("x-mock-user", "superuser1")
                .send(params)
                .redirects(0)
                .end(function(res) {
                    expect(res.status).to.be(400);
                    expect(JSON.parse(res.text)).to.eql({
                        "dateAndTime": "Invalid date or timezone."
                    })
                    done();
                });
        });

        it("should treat 'null' string as an empty date", function(done) {
            var params = {
                title: "Excellent",
                shortName: 'unique-city',
                description: "Party time",
                dateAndTime: "null",
                timeZoneValue: "America/Denver"
            };
            request.post("http://localhost:7777/admin/event/new")
                .set("x-mock-user", "superuser1")
                .send(params)
                .redirects(1)
                .end(function(res) {
                    expect(res.status).to.be(200);
                    var evt = common.server.db.events.findWhere({shortName: "unique-city"});
                    expect(evt.get("dateAndTime")).to.be(null);
                    expect(evt.get("timeZoneValue")).to.be(null);
                    expect(evt.formatDate()).to.eql("");
                    done();
                });
        });

        it("should accept valid times and zones", function(done) {
            var params = {
                title: "Excellent",
                description: "Party time",
                shortName: "unique-city",
                dateAndTime: "2014-11-11T11:11:11",
                timeZoneValue: "America/Denver"
            };
            request.post("http://localhost:7777/admin/event/new")
                .set("x-mock-user", "superuser1")
                .send(params)
                .redirects(1)
                .end(function(res) {
                    expect(res.status).to.be(200);
                    var evt = common.server.db.events.findWhere({shortName: "unique-city"});
                    expect(evt.get("dateAndTime")).to.eql("2014-11-11T11:11:11-07:00");
                    expect(evt.get("timeZoneValue")).to.eql("America/Denver");
                    expect(evt.formatDate()).to.eql("Tuesday, November 11th 2014, 11:11 MST");
                    done();

                });
        });

		it('should redirect to event page on successful creation', function(done) {
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
		it('should set all valid params', function(done) {
            var params = {
                title: "My title",
                organizer: "My organizer",
                shortName: "my-shortName",
                dateAndTime: "2014-11-11T11:11:11",
                timeZoneValue: "America/Denver",
                welcomeMessage: "Wilkommen",
                description: "My description"
            }
			request.post('http://localhost:7777/admin/event/new')
                .set("x-mock-user", "superuser1")
				.send(params)
				.end(function(res) {
                    expect(res.status).to.be(200);
                    var evt = common.server.db.events.findWhere({shortName: "my-shortName"});
                    var att = evt.attributes;
                    expect(att.title).to.eql("My title");
                    expect(att.organizer).to.eql("My organizer");
                    expect(att.shortName).to.eql("my-shortName");
                    expect(att.dateAndTime).to.eql("2014-11-11T11:11:11-07:00");
                    expect(att.timeZoneValue).to.eql("America/Denver");
                    expect(att.welcomeMessage).to.eql("Wilkommen");
                    expect(att.description).to.eql("My description");
                    //
                    // Should also clear all optional params.
                    //
                    request.post('http://localhost:7777/admin/event/' + evt.id)
                        .set("x-mock-user", "superuser1")
                        .send({
                            title: "My title",
                            organizer: "",
                            shortName: "",
                            dateAndTime: "null",
                            welcomeMessage: "",
                            description: "My description"
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
                            done();
                        });
				});
		});
	});

	describe('/admin/event/:id (non-admin)', function() {

		it('should reject well-formed requests from non-admins', function(done) {
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
		it('should reject well-formed requests from admins of other events who don\'t admin this one', function(done) {
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
	});

	describe('/admin/event/:id (admin)', function() {

		it('should accept well-formed creation request from admin', function(done) {
            var user = common.server.db.users.findWhere({"sock-key": "admin1"});
            var evt = common.server.db.events.at(0);
            // the user should bean admin of this event..
            expect(evt.userIsAdmin(user)).to.be(true);
            // .. but they shouldn't need createEvents permission.
            user.setPerm("createEvents", false);

			request.post('http://localhost:7777/admin/event/1')
                .set("x-mock-user", "admin1")
				.send({title:"Test Event", description:"Description of the test event."})
				.redirects(0)
				.end(function(res) {
                    expect(res.status).to.be(302);
                    var evt = common.server.db.events.at(0);
                    expect(evt.get("title")).to.be("Test Event");
                    expect(evt.get("description")).to.be("Description of the test event.");
					done();
				});
		});
		it('should accept well-formed creation request from superuser', function(done) {
			request.post('http://localhost:7777/admin/event/1')
                .set("x-mock-user", "superuser1")
				.send({title:"Test Event", description:"Description of the test event."})
				.redirects(0)
				.end(function(res) {
                    expect(res.status).to.be(302);
                    var evt = common.server.db.events.at(0);
                    expect(evt.get("title")).to.be("Test Event");
                    expect(evt.get("description")).to.be("Description of the test event.");
					done();
				});
		});
	});
});

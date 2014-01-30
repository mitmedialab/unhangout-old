var server = require('../lib/unhangout-server'),
	should = require('should'),
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
                    res.status.should.equal(200);
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
        common.server.db.users.findWhere(
            {"sock-key": "admin1"}).hasPerm("createEvents").should.equal(false);

        async.map(["admin1", "regular1"], function(user, done) {
            request.get("http://localhost:7777/admin/event/new")
                .set("x-mock-user", user)
                .redirects(0)
                .end(function(res) {
                    res.status.should.equal(401);
                    done();
                });
        }, function(err) {
            done();
        });
    });

	describe('/admin/event/new (non-admin)', function() {
		it('should reject well-formed requests from those without permission', function(done) {
            common.server.db.users.findWhere(
                {'sock-key': 'regular1'}).hasPerm("createEvents").should.equal(false);
			request.post('http://localhost:7777/admin/event/new')
                .set("x-mock-user", "regular1")
				.send({title:"Test Event", description:"Description of the test event."})
				.redirects(0)
				.end(function(res) {
					res.status.should.equal(401);
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
					res.status.should.equal(302);
                    var evt = common.server.db.events.at(common.server.db.events.length-1);
                    evt.get("title").should.equal("Test Event");
                    evt.get("description").should.equal("Description of the test event.");

					res.header['location'].should.equal("/event/" + evt.id);

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
					res.status.should.equal(302);
                    var evt = common.server.db.events.at(common.server.db.events.length-1);
                    evt.get("title").should.equal("Test Event");
                    evt.get("description").should.equal("Description of the test event.");

					res.header['location'].should.equal("/event/" + evt.id);

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
					res.status.should.equal(400);
					done();
				});
		});

		it('should redirect to event page on successful creation', function(done) {
			request.post('http://localhost:7777/admin/event/new')
                .set("x-mock-user", "superuser1")
				.send({title:"Test Event", description:"Description of the test event."})
				.redirects(0)
				.end(function(res) {
					res.status.should.equal(302);
                    /\/event\/\d+/.test(res.header['location']).should.equal(true);
					done();
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
					res.status.should.equal(302);
					res.header['location'].should.equal("/");
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
					res.status.should.equal(302);
					res.header['location'].should.equal("/");
					done();
				});
		});
	});

	describe('/admin/event/:id (admin)', function() {

		it('should accept well-formed creation request from admin', function(done) {
            var user = common.server.db.users.findWhere({"sock-key": "admin1"});
            var evt = common.server.db.events.at(0);
            // the user should bean admin of this event..
            evt.userIsAdmin(user).should.equal(true);
            // .. but they shouldn't need createEvents permission.
            user.setPerm("createEvents", false);

			request.post('http://localhost:7777/admin/event/1')
                .set("x-mock-user", "admin1")
				.send({title:"Test Event", description:"Description of the test event."})
				.redirects(0)
				.end(function(res) {
					res.status.should.equal(302);
                    var evt = common.server.db.events.at(0);
                    evt.get("title").should.equal("Test Event");
                    evt.get("description").should.equal("Description of the test event.");
					done();
				});
		});
		it('should accept well-formed creation request from superuser', function(done) {
			request.post('http://localhost:7777/admin/event/1')
                .set("x-mock-user", "superuser1")
				.send({title:"Test Event", description:"Description of the test event."})
				.redirects(0)
				.end(function(res) {
					res.status.should.equal(302);
                    var evt = common.server.db.events.at(0);
                    evt.get("title").should.equal("Test Event");
                    evt.get("description").should.equal("Description of the test event.");
					done();
				});
		});
	});
});

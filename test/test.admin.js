var server = require('../lib/unhangout-server'),
	should = require('should'),
	_ = require('underscore')._,
	request = require('superagent');

var s;
var sock;
var session;

var mockSetup = function(admin, callback) {
	return function(done) {
		s = new server.UnhangoutServer();
		s.on("inited", function() {s.start()});
		s.on("started", function() {
			if(callback) {
				callback(done);
			} else {
				done();
			}
		});
		
		if(_.isUndefined(admin)) {
			admin = false;
		}

		s.init({"transport":"file", "level":"debug", "GOOGLE_CLIENT_ID":true, "GOOGLE_CLIENT_SECRET":true, "REDIS_DB":1, "mock-auth":true, "mock-auth-admin":admin});		
	}
}

var standardShutdown = function(done) {
	s.on("stopped", function() {
		s.on("destroyed", done);
		s.destroy();
	});
	s.stop();
};


describe('HTTP ADMIN API', function() {
	afterEach(standardShutdown);

	describe('/admin/event/new (non-admin)', function() {
		beforeEach(mockSetup(false));
		it('should reject well-formed requests from non-admins', function(done) {
			request.post('http://localhost:7777/admin/event/new')
				.send({title:"Test Event", description:"Description of the test event."})
				.redirects(0)
				.end(function(res) {
					res.status.should.equal(302);
					// res.header['location'].should.equal("/auth/google");
					done();
				});
		});
	});

	describe('/admin/event/new (admin)', function() {
		beforeEach(mockSetup(true));

		it('should accept well-formed creation request from admin', function(done) {
			console.log(JSON.stringify(s.users.at(0)));

			request.post('http://localhost:7777/admin/event/new')
				.send({title:"Test Event", description:"Description of the test event."})
				.redirects(0)
				.end(function(res) {
					res.status.should.equal(302);
					s.events.at(s.events.length-1).get("title").should.equal("Test Event");
					s.events.at(s.events.length-1).get("description").should.equal("Description of the test event.");

					res.header['location'].should.equal("/admin");

					done();
				});
		});

		it('should reject requests that are missing required parameters');
		it('should redirect to /admin/ on successful creation');
	});

	describe('/admin/event/:id', function() {
		it('should reject well-formed requests from non-admins');
		it('should accept well-formed creation request from admin');
		it('should redirect to /admin/event/:id on successful creation');
	});
});
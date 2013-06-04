var server = require('../lib/unhangout-server'),
	should = require('should'),
	request = require('superagent');

var s;

var standardSetup = function() {
	s = new server.UnhangoutServer();
	s.init({"transport":"file", "level":"debug", "GOOGLE_CLIENT_ID":true, "GOOGLE_CLIENT_SECRET":true});
	s.start();
}

var standardShutdown = function(done) {
	s.stop();
	s.on("stopped", function() {
		s.on("destroyed", done);
		s.destroy();
	})
}

describe('unhangout server', function() {
	describe('configuration', function() {
		beforeEach(function() {
			s = new server.UnhangoutServer();
		});
		
		it('should not initialize without google credentials', function(done) {
			s.on("error", function() {
				done();
			});
			s.on("inited", function() {
				should.fail("Expected an error.");
			});
			s.init({"transport":"file", "level":"debug"});
		});
		
		it('#start should fail if init is not called first', function(done) {
			s.on("error", function() {
				done();
			});
			
			s.on("started", function() {
				should.fail("expected an error");
			});
			s.start();
		});
		
		it("#stop should fail if not started", function(done) {
			s.on("error", function() {
				done();
			});
			
			s.on("started", function() {
				should.fail("expected an error");
			});
			s.stop();
		});
		
		it("#destroy should succeed regardless of state", function(done) {
			s.on("destroyed", function() {
				done();
			});
			
			s.on("error", function() {
				should.fail();
			})
			
			s.destroy();
		});
	});
	
	
	describe('setup', function() {
		beforeEach(function() {
			s = new server.UnhangoutServer();
			s.init({"transport":"file", "level":"debug", "GOOGLE_CLIENT_ID":true, "GOOGLE_CLIENT_SECRET":true});
		});

		afterEach(standardShutdown);
		
		it('#start should start', function() {
			s.start();
		});
		
		it("#start should emit 'started' message when complete", function(done) {
			s.on("started", done);
			s.start();
		});
	});
	
	
	describe('routes', function() {
		
		beforeEach(standardSetup);
		
		afterEach(standardShutdown);
		
		
		describe("GET /", function() {
			it('should return without error', function(done) {
				request('http://localhost:7777/', function(args) {
					should.not.exist(args.err);
					should.exist(args.res);
					done();
				});
			});
		});
	});
})
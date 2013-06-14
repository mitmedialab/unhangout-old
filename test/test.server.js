var server = require('../lib/unhangout-server'),
	should = require('should'),
	_ = require('underscore')._,
	sock_client = require('sockjs-client'),
	request = require('superagent'),
	redis = require('redis').createClient();
	seed = require('../bin/seed.js');

var s;
var sock;

var standardSetup = function(done) {
	s = new server.UnhangoutServer();
	s.on("inited", function() {s.start()});
	s.on("started", done);
	
	seed.run(1, redis, function() {
		s.init({"transport":"file", "level":"debug", "GOOGLE_CLIENT_ID":true, "GOOGLE_CLIENT_SECRET":true, "REDIS_DB":1});		
	});
}

var mockSetup = function(done) {
	s = new server.UnhangoutServer();
	s.on("inited", function() {s.start()});
	s.on("started", done);
	
	seed.run(1, redis, function() {
		s.init({"transport":"file", "level":"debug", "GOOGLE_CLIENT_ID":true, "GOOGLE_CLIENT_SECRET":true, "REDIS_DB":1, "mock-auth":true});		
	});
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
		beforeEach(function(done) {
			s = new server.UnhangoutServer();
			s.on("inited", done);
			s.init({"transport":"file", "level":"debug", "GOOGLE_CLIENT_ID":true, "GOOGLE_CLIENT_SECRET":true});
		});

		afterEach(standardShutdown);
		
		it("#start should emit 'started' message when complete", function(done) {
			s.on("started", done);
			s.start();
		});
	});
	
	
	describe('routes (unauthenticated)', function() {
		beforeEach(standardSetup);
		afterEach(standardShutdown);
		
		describe("GET /", function() {
			it('should return without error', function(done) {
				request('http://localhost:7777/').end(function(res) {
					should.exist(res);
					res.status.should.equal(200);
					done();
				});
			});
		});
		
		describe("GET /event/:id", function() {
			it('should redirect to authentication, if unauthenticated', function(done) {
				request('http://localhost:7777/event/0')
				.redirects(0)
				.end(function(res) {
					res.status.should.equal(302);
					res.header['location'].should.equal("/auth/google");
					done();
				});
			});
		});
	});
	
	describe('routes (authenticated)', function() {
		beforeEach(mockSetup);
		afterEach(standardShutdown);
		
		describe("GET /event/:id", function() {
			it('should allow connections without redirection', function(done) {
				request('http://localhost:7777/event/1')
				.end(function(res) {
					res.status.should.equal(200);
					done();
				});				
			});
		});
	});
	
	describe('sock (mock)', function() {
		beforeEach(mockSetup);
		afterEach(standardShutdown);

		it('should accept a connection at /sock', function(done) {
			var sock = sock_client.create("http://localhost:7777/sock");
			sock.on("connection", done);
		});
		
		it('should consider the socket unauthenticated before an AUTH message', function(done) {
			var sock = sock_client.create("http://localhost:7777/sock");
			sock.on("connection", function() {
				var socketsList = _.values(s.unauthenticatedSockets);
				socketsList.length.should.equal(1);
				socketsList[0].authenticated.should.equal(false);
				done();
			});
		});
		
		it('should reject a bad authorization key', function(done) {
			var sock = sock_client.create("http://localhost:7777/sock");
			sock.on("data", function(message) {
				var msg = JSON.parse(message);
				
				if(msg.type=="auth-err") {
					done();
				}
			});
			
			sock.on("connection", function() {
				sock.write(JSON.stringify({type:"auth", args:{key:"abe027d9c910236af", id:"0"}}));
			});	
		});
		
		it('should reject a good authorization key for the wrong id', function(done) {
			var sock = sock_client.create("http://localhost:7777/sock");
			sock.on("data", function(message) {
				var msg = JSON.parse(message);
				
				if(msg.type=="auth-err") {
					done();
				}
			});
			
			sock.on("connection", function() {
				var user = s.users.at(0);
				sock.write(JSON.stringify({type:"auth", args:{key:user.getSockKey(), id:"1"}}));
			});	
		});
		
		it('should accept a good authorization key', function(done) {
			var sock = sock_client.create("http://localhost:7777/sock");
			sock.on("data", function(message) {
				var msg = JSON.parse(message);
				
				if(msg.type=="auth-ack") {
					done();
				}
			});
			
			sock.on("connection", function() {
				var user = s.users.at(0);
				sock.write(JSON.stringify({type:"auth", args:{key:user.getSockKey(), id:user.id}}));
			});	
		});
		
		it('should trigger a disconnect event when closing the socket', function(done) {
			var sock = sock_client.create("http://localhost:7777/sock");
			sock.on("data", function(message) {
				var msg = JSON.parse(message);
				
				if(msg.type=="auth-ack") {
					sock.close();
				}
			});
			
			sock.on("connection", function() {
				var user = s.users.at(0);
				
				user.on("disconnect", done);
				
				sock.write(JSON.stringify({type:"auth", args:{key:user.getSockKey(), id:user.id}}));
			});	
		});
		
		describe("JOIN", function() {
			beforeEach(function(done) {
				sock = sock_client.create("http://localhost:7777/sock");
				sock.once("data", function(message) {
					var msg = JSON.parse(message);

					if(msg.type=="auth-ack") {
						done();
					}
				});

				sock.on("connection", function() {
					var user = s.users.at(0);
					sock.write(JSON.stringify({type:"auth", args:{key:user.getSockKey(), id:user.id}}));
				});	
			});
			
			it("should accept a join message with a valid event id", function(done) {
				sock.once("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="join-ack") {
						s.events.get(1).numUsersConnected().should.equal(1);
						done();
					}
				});
				
				sock.write(JSON.stringify({type:"join", args:{id:1}}));
			});
			
			it("should reject a join message with an invalid event id", function(done) {
				sock.once("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="join-err") {
						done();
					}
				});
												// 0 is not a valid event id in seeds
				sock.write(JSON.stringify({type:"join", args:{id:0}}));
			});
			
			it("should reject an ATTEND message before a join");
		});
		
		describe("ATTEND", function() {
			beforeEach(function(done) {
				sock = sock_client.create("http://localhost:7777/sock");
				sock.on("data", function(message) {
					var msg = JSON.parse(message);

					if(msg.type=="auth-ack") {
						
						// Joining event id 1 for all these tests, valid session ids for that
						// event are 1, 2, 3 (invalid are 4, 5, 6)
						sock.write(JSON.stringify({type:"join", args:{id:1}}));
					} else if(msg.type=="join-ack") {
						sock.removeAllListeners();
						done();
					}
				});

				sock.on("connection", function() {
					var user = s.users.at(0);
					sock.write(JSON.stringify({type:"auth", args:{key:user.getSockKey(), id:user.id}}));
				});	
			});
			
			it("should accept an ATTEND request with a valid session id (part of event)", function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="attend-ack") {
						done();
					} else if(msg.type=="attend-err") {
						should.fail();
					}
				});

				sock.write(JSON.stringify({type:"attend", args:{id:1}}));
			});
			
			it('should reject an ATTEND request with a valid session id (not part of event)', function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="attend-ack") {
						should.fail();
					} else if(msg.type=="attend-err") {
						done();
					}
				});

				sock.write(JSON.stringify({type:"attend", args:{id:4}}));
			});
			
			it('should reject an ATTEND request with an invalid session id', function(done) {
				sock.once("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="attend-ack") {
						should.fail();
					} else if(msg.type=="attend-err") {
						done();
					}
				});

				sock.write(JSON.stringify({type:"attend", args:{id:4}}));
			});
			
			it('should increment attendee count', function(done) {
				var session = s.events.get(1).get("sessions").get(1);
				session.numAttendees().should.equal(0);
				
				sock.on("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="attend-ack") {
						session.numAttendees().should.equal(1);
						done();
					} else if(msg.type=="attend-err") {
						should.fail();
					}
				});

				sock.write(JSON.stringify({type:"attend", args:{id:1}}));	
			});
			
			it('should generate a message to clients joined to that event', function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="attend") {
						msg.args.should.have.keys("id", "user");
						done();
					} else if(msg.type=="attend-err") {
						should.fail();
					}
				});

				sock.write(JSON.stringify({type:"attend", args:{id:1}}));				
			});
		});
	});
})
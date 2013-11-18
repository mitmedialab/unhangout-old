var server = require('../lib/unhangout-server'),
	should = require('should'),
	_ = require('underscore')._,
	sock_client = require('sockjs-client'),
	request = require('superagent'),
	seed = require('../bin/seed.js'),
    common = require("./common");

var s;
var sock;
var session;

var joinEventSetup = function(userKey) {
    return function(done) {
        common.authedSock(userKey, 1, function(newSock) {
            sock = newSock;
            sock.write(JSON.stringify({
                type: "join",
                args: {id: common.server.db.events.at(0).getRoomId()}
            }));
            sock.once("data", function(message) {
                var data = JSON.parse(message);
                if (data.type == "join-ack") {
                    done();
                } else {
                    throw new Error(message);
                }
            });
        });
    }
};

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
			s.init({});
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

		afterEach(function(done) {
            common.standardShutdown(done, s);
        });
		
		it("#start should emit 'started' message when complete", function(done) {
			s.on("started", done);
			s.start();
		});
	});
	
	
	describe('routes (unauthenticated)', function() {
		beforeEach(common.standardSetup);
		afterEach(common.standardShutdown);
		
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
		beforeEach(common.standardSetup);
		afterEach(common.standardShutdown);
		
		describe("GET /event/:id", function() {
			it('should allow connections without redirection', function(done) {
				request('http://localhost:7777/event/1')
                .set("x-mock-user", "regular1")
				.end(function(res) {
					res.status.should.equal(200);
					done();
				});				
			});
		});
	});

	describe('POST /subscribe', function() {
		beforeEach(common.standardSetup);
		afterEach(common.standardShutdown);

		it('should accept email addresses', function(done) {
			request.post('http://localhost:7777/subscribe')
			.send("email=email@example.com")
			.end(function(res) {
				res.status.should.equal(200);

				common.server.db.redis.lrange("global:subscriptions", -1, 1, function(err, res) {
					if(res=="email@example.com") {
						done();
					}
				});
			});
		});
	});


	describe('GET /h/:code', function(){
		beforeEach(common.standardSetup);
		afterEach(common.standardShutdown);

		it('should direct to the landing page when there is no code', function(done){
			request.get('http://localhost:7777/h/')
				.end(function(res){
					res.status.should.equal(200);
					done();
				});
		});

		it('if :code is new, it should create a new session on the server', function(done){
			request.get('http://localhost:7777/h/' + Math.floor(Math.random()*100000))
				.redirects(0)
				.end(function(res){
					res.status.should.equal(302);
					common.server.db.permalinkSessions.length.should.equal(1);
					done();
				});
		});

		it('if :code is active, multiple requests only create one session', function(done){
			request.get('http://localhost:7777/h/test')
				.redirects(0)
				.end(function(res){
					res.status.should.equal(302);
					common.server.db.permalinkSessions.length.should.equal(1);
					request.get('http://localhost:7777/h/test')
						.end(function(res){
							res.status.should.equal(200);
							common.server.db.permalinkSessions.length.should.equal(1);
							done();
						});
				});
		});

		it('if :code is new, it should present the form only for first visitor', function(done){
			request.get('http://localhost:7777/h/test')
				.end(function(res){
					res.text.indexOf('<input').should.not.equal(-1);
					request.get('http://localhost:7777/h/test')
						.end(function(res){
							res.text.indexOf('<input').should.equal(-1);
							done();
						});
				});
		});
	});

	describe('POST /h/admin/:code', function(){
		beforeEach(function(done) {
            common.standardSetup(function() {
                request.get('http://localhost:7777/h/test')
                    .end(function(res) {
                        res.status.should.equal(200);
                        done();
                    });
            });
		});

		afterEach(common.standardShutdown);

		it('should reject requests without a valid creation key in the request body', function(done){
			var session = common.server.db.permalinkSessions[0];
			request.post('http://localhost:7777/h/admin/test')
				.send({creationKey: 'wrong1', title: 'migrate title', description: 'something cool'})
				.end(function(res){
					res.status.should.equal(403);
					done();
				});
		});

		it('should update session title and description when valid creation key is present', function(done){
			var session = common.server.db.permalinkSessions.at(0);
			request.post('http://localhost:7777/h/admin/test')
				.send({creationKey: session.get('creationKey'), title: 'migrate title', description: 'something cool'})
				.end(function(res){
					res.status.should.equal(200);
					session.get('title').should.equal('migrate title');
					session.get('description').should.equal('something cool');
					done();
				});
		});
	});

	describe('POST /session/hangout/:id', function() {
		beforeEach(function(done) {
            common.standardSetup(function() {
				// we need to start one of the sessions so it has a valid session key for any of this stuff to work.
				session = common.server.db.events.at(0).get("sessions").at(0);
				done();
			})
        });

		afterEach(common.standardShutdown);

		it('should handle loaded properly', function(done) {
			var fakeUrl = "http://plus.google.com/hangout/_/abslkjasdlfkjasdf";

			request.post('http://localhost:7777/session/hangout/' + session.get("session-key"))
				.send("type=loaded&url=" + encodeURIComponent(fakeUrl))
				.end(function(res) {
					res.status.should.equal(200);

					// this indexOf check is because the actual set url has a bunch of extra
					// url get params in it (like the hangout app gid, and startup params) 
					// so we just make sure that it STARTS with our string.
					session.get("hangout-url").indexOf(fakeUrl).should.equal(0);
					done();
				});
		});



		it('should handle participants properly', function(done) {
			request.post('http://localhost:7777/session/hangout/' + session.get("session-key"))
				.send({type:"participants", participants:[{person:{id:1}}, {person:{id:2}}]})
				.end(function(res) {
					res.status.should.equal(200);

					// this indexOf check is because the actual set url has a bunch of extra
					// url get params in it (like the hangout app gid, and startup params) 
					// so we just make sure that it STARTS with our string.
					session.getNumConnectedParticipants().should.equal(2);
					done();
				});
		});

		it('should handle heartbeat properly', function(done) {
			request.post('http://localhost:7777/session/hangout/' + session.get("session-key"))
				.send({type:"heartbeat", from:1213141235})
				.end(function(res) {
					res.status.should.equal(200);

					session.get("last-heartbeat").should.not.equal(null);
					done();
				});
		});

		it('should ignore requests without an id in the url', function(done) {
			request.post('http://localhost:7777/session/hangout/') // <--- note missing session-key in url
				.send({type:"heartbeat", from:1213141235})
				.end(function(res) {
					res.status.should.equal(404);
					done();
				});
		});

		it('should ignore requests without a type in the body', function(done) {
			request.post('http://localhost:7777/session/hangout/' + session.get("session-key"))
				.send({from:1213141235})
				.end(function(res) {
					res.status.should.equal(400);
					done();
				});

		});

		it('should ignore requests for sessions that haven\'t started yet / have invalid session-keys', function(done) {
			request.post('http://localhost:7777/session/hangout/' + "abe283917cd692387162bea283") // <--- note random session key
				.send({type:"heartbeat", from:1213141235})
				.end(function(res) {
					res.status.should.equal(400);
					done();
				});
		});
	});
	
	describe('sock (mock)', function() {
		beforeEach(common.standardSetup);
		afterEach(common.standardShutdown);

		describe("CREATE-SESSION", function() {
			beforeEach(joinEventSetup("regular1"));

			it("should accept create session messages", function(done) {
                var event = common.server.db.events.at(0);
				sock.on("data", function(message) {
					var msg = JSON.parse(message);

					if(msg.type=="create-session-ack") {
						done();
					} else if(msg.type=="create-session-err") {
                        console.log(msg);
						should.fail();
					}
				});

				common.server.db.users.at(0).set("superuser", true);
				
				sock.write(JSON.stringify({
                    type:"create-session",
                    args:{
                        title: "New Session",
                        description:"This is a description.",
                        roomId: event.getRoomId()
                    }
                }));
			});

			it("should reject messages from non-admins", function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="create-session-ack") {
						should.fail();
					} else if(msg.type=="create-session-err") {
						done();
					}
				});
				
				sock.write(JSON.stringify({type:"create-session", args:{title: "New Session", description:"This is a description."}}));
			});

			it("should reject create session messages without name", function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);

					if(msg.type=="create-session-ack") {
						should.fail();
					} else if(msg.type=="create-session-err") {
						done();
					}
				});

				common.server.db.users.at(0).set("superuser", true);
				
				sock.write(JSON.stringify({type:"create-session", args:{title: "New Session"}}));
			});

			it("should reject create session messages without description", function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);

					if(msg.type=="create-session-ack") {
					} else if(msg.type=="create-session-err") {
						done();
					}
				});

				common.server.db.users.at(0).set("superuser", true);
				
				sock.write(JSON.stringify({type:"create-session", args:{description:"This is a description."}}));
			});

			it("should broadcast a create-session message to clients", function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);

					// note create-session not create-session-ack
					if(msg.type=="create-session") {
						msg.args.title.should.equal("New Session");
						msg.args.description.should.equal("This is a description.");
						done();
					} else if(msg.type=="create-session-err") {
						should.fail();
					}
				});

				common.server.db.users.at(0).set("superuser", true);
				
				sock.write(JSON.stringify({
                    type:"create-session",
                    args: {
                        title: "New Session",
                        description:"This is a description.",
                        roomId: common.server.db.events.at(0).getRoomId()
                    }
                }));
			});
		});
		
		describe("OPEN/CLOSE SESSIONS", function() {
			beforeEach(joinEventSetup("regular1"));

			it("should accept open messages from admins", function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="open-sessions-ack") {
						common.server.db.events.get(1).sessionsOpen().should.be.true
						done();
					} else if(msg.type=="open-sessions-err") {
                        console.error(msg);
						should.fail();
					}
				});
				
				common.server.db.users.at(0).set("superuser", true);
				sock.write(JSON.stringify({
                    type:"open-sessions",
                    args: { roomId: common.server.db.events.at(0).getRoomId() }
                }));
			});
			
			it("should generate messages to everyone in the event on open sessions", function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="open-sessions") {
						done();
					} else if(msg.type=="open-sessions-err") {
						should.fail();
					}
				});

				common.server.db.users.at(0).set("superuser", true);
				sock.write(JSON.stringify({type:"open-sessions", args:{
                    roomId: common.server.db.events.at(0).getRoomId()
                }}));
			});

			it("should accept close messages from admins", function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="close-sessions-ack") {
						common.server.db.events.get(1).sessionsOpen().should.be.false
						done();
					} else if(msg.type=="close-sessions-err") {
						should.fail();
					}
				});
				
				common.server.db.users.at(0).set("superuser", true);
				sock.write(JSON.stringify({type:"close-sessions", args: {
                    roomId: common.server.db.events.at(0).getRoomId()
                }}));
			});
			
			it("should generate messages to everyone in the event on close sessions", function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="close-sessions") {
						done();
					} else if(msg.type=="close-sessions-err") {
						should.fail();
					}
				});

				common.server.db.users.at(0).set("superuser", true);
				sock.write(JSON.stringify({type:"close-sessions", args:{
                    roomId: common.server.db.events.at(0).getRoomId()
                }}));
			});


		})

		describe("EMBED", function() {
			beforeEach(joinEventSetup("regular1"));
			
			it("should reject embed messages from non-admins", function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="embed-ack") {
						should.fail();
					} else if(msg.type=="embed-err") {
						done();
					}
				});
				
				sock.write(JSON.stringify({type:"embed", args:{ydId:"QrsIICQ1eg8"}}));
			});
			
			
			it("should reject embed messages without a ytId argument", function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="embed-ack") {
						should.fail();
					} else if(msg.type=="embed-err") {
						done();
					}
				});
				
				common.server.db.users.at(0).set("superuser", true);
				
				sock.write(JSON.stringify({type:"embed", args:{}}));
			});
			
			
			it("should accept embed messages from admins", function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="embed-ack") {
						done();
					} else if(msg.type=="embed-err") {
						should.fail();
					}
				});
				
				common.server.db.users.at(0).set("superuser", true);
				
				sock.write(JSON.stringify({type:"embed", args:{
                    ytId:"QrsIICQ1eg8",
                    roomId: common.server.db.events.at(0).getRoomId()
                }}));
			});
			
			it("should generate messages to everyone in the event on embed", function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="embed") {
						msg.args.ytId.should.equal("QrsIICQ1eg8");
						done();
					} else if(msg.type=="embed-err") {
						should.fail();
					}
				});
				
				common.server.db.users.at(0).set("superuser", true);
				
				sock.write(JSON.stringify({type:"embed", args:{
                    ytId:"QrsIICQ1eg8",
                    roomId: common.server.db.events.at(0).getRoomId()
                }}));
			});	
		});

		describe("CHAT", function() {
			beforeEach(joinEventSetup("regular1"));
			
			it("should reject a chat message without text argument", function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="chat-ack") {
						should.fail();
					} else if(msg.type=="chat-err") {
						done();
					}
				});
				
				sock.write(JSON.stringify({type:"chat", args:{
                    roomId: common.server.db.events.at(0).getRoomId()
                }}));
			});
			
			it("should accept a chat message with proper arguments", function(done) {
				sock.on("data", function(message) {
					var msg = JSON.parse(message);
					if(msg.type=="chat-ack") {
						done();
					} else if(msg.type=="chat-err") {
						should.fail();
					}
				});				
				sock.write(JSON.stringify({type:"chat", args: {
                    text:"hello world",
                    roomId: common.server.db.events.at(0).getRoomId()
                }}));
			});
			
			
		//  These two tests should in principle work, but the mock authentication scheme we're using
		//  doesn't seem to gracefully support having TWO mock users. So, putting these tests on hold for now
		//  until we can really create a second user to test against.
//			it("should broadcast a chat message to everyone in event", function(done) {
//				connectNewSock(function(altSock) {
//					// at this point we have two sockets; sock and altSock. Both are connected to event.
//					altSock.on("data", function(message) {
//
//						var msg = JSON.parse(message);
//						if(msg.type=="chat") {
//							msg.args.should.have.keys("text", "user", "time");
//							msg.args.text.should.equal("hello world");
//							done();
//						}
//					});
//					
//					sock.write(JSON.stringify({type:"chat", args:{text:"hello world"}}));
//				});
//			});
//			
//			it("should not send the chat message to users in other events", function(done) {
//				done();
//			});
		});
		
	});
})

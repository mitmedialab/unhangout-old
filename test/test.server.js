var unhangoutServer = require('../lib/unhangout-server'),
    should = require('should'),
    expect = require('expect.js'),
    _ = require('underscore')._,
    request = require('superagent'),
    seed = require('../bin/seed.js'),
    common = require("./common");

var server;
var sock;
var session;

var joinEventSetup = function(userKey) {
    return function(done) {
        common.authedSock(userKey, 1, function(newSock) {
            sock = newSock;
            sock.write(JSON.stringify({
                type: "join",
                args: {
                    id: common.server.db.events.findWhere({
                        shortName: "writers-at-work"
                    }).getRoomId()
                }
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
    this.timeout(10000); // Socket tests take a little extra time on slow systems.

    describe('configuration', function() {
        beforeEach(function() {
            server = new unhangoutServer.UnhangoutServer();
        });

        it('#start should fail if init is not called first', function(done) {
            server.on("error", function() {
                done();
            });

            server.on("started", function() {
                should.fail("expected an error");
            });
            server.start();
        });

        it("#stop should fail if not started", function(done) {
            server.on("error", function() {
                done();
            });

            server.on("started", function() {
                should.fail("expected an error");
            });
            server.stop();
        });

        it("#destroy should succeed regardless of state", function(done) {
            server.on("destroyed", function() {
                done();
            });

            server.on("error", function() {
                should.fail();
            })

            server.destroy();
        });
    });


    describe('setup', function() {
        beforeEach(function(done) {
            server = new unhangoutServer.UnhangoutServer();
            server.on("inited", done);
            server.init({"UNHANGOUT_GOOGLE_CLIENT_ID":true, "UNHANGOUT_GOOGLE_CLIENT_SECRET":true});
        });

        afterEach(function(done) {
            common.standardShutdown(done, server);
        });

        it("#start should emit 'started' message when complete", function(done) {
            server.on("started", done);
            server.start();
        });
    });


    describe('routes (unauthenticated)', function() {
        beforeEach(common.standardSetup);
        afterEach(common.standardShutdown);

        describe("GET /", function() {
            it('should return without error', function(done) {
                request(common.URL).end(function(res) {
                    should.exist(res);
                    res.status.should.equal(200);
                    done();
                });
            });
        });

        describe("GET /event/:id", function() {
            it('should show static event page if unauthenticated', function(done) {
                request(common.URL + '/event/1')
                .redirects(0)
                .end(function(res) {
                    res.status.should.equal(200);
                    done();
                });
            });
        });
    });

    describe('routes (authenticated)', function() {
        beforeEach(common.standardSetup);
        afterEach(common.standardShutdown);

        describe("GET /event/:id", function() {
            it('should show dynamic event page', function(done) {
                request(common.URL + '/event/1')
                .set("x-mock-user", "regular1")
                .end(function(res) {
                    res.status.should.equal(200);
                    done();
                });
            });
        });
    });

    describe('POST /subscribe/', function() {
        beforeEach(common.standardSetup);
        afterEach(common.standardShutdown);

        it('should accept email addresses', function(done) {
            request.post(common.URL + '/subscribe/')
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


    describe('sock (mock)', function() {
        beforeEach(common.standardSetup);
        afterEach(common.standardShutdown);

        describe("CREATE-SESSION", function() {
            beforeEach(joinEventSetup("regular1"));

            it("should accept create session messages", function(done) {
                var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
                sock.on("data", function(message) {
                    var msg = JSON.parse(message);

                    if(msg.type=="create-session-ack") {
                        done();
                    } else if(msg.type=="create-session-err") {
                        console.log("error", msg);
                        should.fail();
                    }
                });

                var user = common.server.db.users.findWhere({"sock-key": "regular1"});
                user.set("superuser", true);

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

                var user = common.server.db.users.findWhere({"sock-key": "regular1"});
                user.set("superuser", true);

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

                var user = common.server.db.users.findWhere({"sock-key": "regular1"});
                user.set("superuser", true);

                sock.write(JSON.stringify({type:"create-session", args:{description:"This is a description."}}));
            });

            it("should broadcast a create-session message to clients", function(done) {
                sock.on("data", function(message) {
                    var msg = JSON.parse(message);
                    if(msg.type == "state" && msg.args.type === 'Session') {
                        expect(msg.args.path).to.eql(['event', 'sessions']);
                        expect(msg.args.op).to.eql('insert');
                        expect(msg.args.value.title).to.be("New Session");
                        expect(msg.args.value.description).to.be("This is a description.");
                        done();
                    } else if(msg.type=="create-session-err") {
                        should.fail();
                    }
                });

                var user = common.server.db.users.findWhere({"sock-key": "regular1"});
                user.set("superuser", true);

                sock.write(JSON.stringify({
                    type:"create-session",
                    args: {
                        title: "New Session",
                        description:"This is a description.",
                        roomId: common.server.db.events.findWhere({
                            shortName: "writers-at-work"
                        }).getRoomId()
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
                        common.server.db.events.get(1).get("sessionsOpen").should.be.true
                        done();
                    } else if(msg.type=="open-sessions-err") {
                        console.error(msg);
                        should.fail();
                    }
                });

                var user = common.server.db.users.findWhere({"sock-key": "regular1"});
                user.set("superuser", true);
                sock.write(JSON.stringify({
                    type:"open-sessions",
                    args: {
                        roomId: common.server.db.events.findWhere({
                            shortName: "writers-at-work"
                        }).getRoomId()
                    }
                }));
            });

            it("should generate messages to everyone in the event on open sessions", function(done) {
                sock.on("data", function(message) {
                    var msg = JSON.parse(message);
                    if(msg.type === "state" && msg.args.path[1] === "sessionsOpen") {
                        expect(msg.args.path).to.eql(["event", "sessionsOpen"]);
                        expect(msg.args.op).to.be("set");
                        expect(msg.args.value).to.be(true);
                        done();
                    } else if(msg.type=="open-sessions-err") {
                        should.fail();
                    }
                });

                var user = common.server.db.users.findWhere({"sock-key": "regular1"});
                user.set("superuser", true);

                sock.write(JSON.stringify({type:"open-sessions", args:{
                    roomId: common.server.db.events.findWhere({
                        shortName: "writers-at-work"
                    }).getRoomId()
                }}));
            });

            it("should accept close messages from admins", function(done) {
                sock.on("data", function(message) {
                    var msg = JSON.parse(message);
                    if(msg.type === "close-sessions-ack") {
                        done();
                    } else if(msg.type=="close-sessions-err") {
                        should.fail();
                    }
                });

                var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
                var user = common.server.db.users.findWhere({"sock-key": "regular1"});
                user.set("superuser", true);

                sock.write(JSON.stringify({type:"close-sessions", args: {
                    roomId: event.getRoomId()
                }}));
            });

            it("should generate messages to everyone in the event on close sessions", function(done) {
                sock.on("data", function(message) {
                    var msg = JSON.parse(message);
                    if (msg.type === "state" && msg.args.path[1] === "sessionsOpen") {
                        expect(msg.args.path).to.eql(["event", "sessionsOpen"]);
                        expect(msg.args.op).to.be("set");
                        expect(msg.args.value).to.be(false);
                        common.server.db.events.get(1).get("sessionsOpen").should.be.false
                        done();
                    } else if (msg.type=="close-sessions-err") {
                        should.fail();
                    }
                });

                var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
                event.set("sessionsOpen", true, {silent: true});
                var user = common.server.db.users.findWhere({"sock-key": "regular1"});
                user.set("superuser", true);

                sock.write(JSON.stringify({type:"close-sessions", args:{
                    roomId: common.server.db.events.findWhere({
                        shortName: "writers-at-work"
                    }).getRoomId()
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

                var user = common.server.db.users.findWhere({"sock-key": "regular1"});
                user.set("superuser", true);


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

                var user = common.server.db.users.findWhere({"sock-key": "regular1"});
                user.set("superuser", true);

                sock.write(JSON.stringify({type:"embed", args:{
                    ytId:"QrsIICQ1eg8",
                    roomId: common.server.db.events.findWhere({
                        shortName: "writers-at-work"
                    }).getRoomId()
                }}));
            });

            it("should generate messages to everyone in the event on embed", function(done) {
                sock.on("data", function(message) {
                    var msg = JSON.parse(message);
                    if(msg.type === "state" && msg.args.path[1] === "youtubeEmbed") {
                        msg.args.value.should.equal("QrsIICQ1eg8");
                        done();
                    } else if(msg.type=="embed-err") {
                        should.fail();
                    }
                });

                var user = common.server.db.users.findWhere({"sock-key": "regular1"});
                user.set("superuser", true);

                sock.write(JSON.stringify({type:"embed", args:{
                    ytId:"QrsIICQ1eg8",
                    roomId: common.server.db.events.findWhere({
                        shortName: "writers-at-work"
                    }).getRoomId()
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
                    roomId: common.server.db.events.findWhere({
                        shortName: "writers-at-work"
                    }).getRoomId()
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
                    roomId: common.server.db.events.findWhere({
                        shortName: "writers-at-work"
                    }).getRoomId()
                }}));
            });
        });
    });
})

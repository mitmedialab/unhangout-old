var RoomManager = require("../lib/room-manager").RoomManager,
    createUsers = require("../lib/passport-mock").createUsers,
    models = require("../lib/server-models"),
    http = require("http"),
    async = require("async"),
    expect = require("expect.js"),
    sockjs = require("sockjs"),
    sockjs_client = require('sockjs-client'),
    _ = require("underscore");

var users = createUsers(new models.ServerUserList());
var server = http.createServer();
var socketServer = sockjs.createServer({log: function(severity, message){
    if (severity == "error") {
        console.log(message);
    }
}});
socketServer.installHandlers(server, {prefix: '/sock'});
server.listen(7777, '0.0.0.0');

// Connect an unauthenticated socket.
function connectSocket(connectCallback, dataCallback) {
    var sock = sockjs_client.create("http://localhost:7777/sock");
    sock.on("connection", function() { connectCallback(sock); });
    sock.on("data", function(message) {
        dataCallback(sock, JSON.parse(message));
    });
    sock.on("error", function(data) { throw new Error(data); });
}

// Get a socket authenticated for the given user.
function authedSocket(user, callback) {
    var sock = sockjs_client.create("http://localhost:7777/sock");
    sock.once("connection", function() {
        sock.write(JSON.stringify({
            type: "auth", args: {id: user.id, key: user.getSockKey()}
        }));
    });
    sock.once("data", function(message) {
        if (JSON.parse(message).type == "auth-ack") {
            callback(sock);
        } else {
            throw new Error(message);
        }
    });
    sock.on("error", function(data) { 
        throw new Error(data);
    });
}

describe("ROOM MANAGER", function() {
    it("Fires auth events", function(done) {
        var mgr = new RoomManager(socketServer, users);
        var user = users.at(0);
        mgr.on("auth", function(data) {
            expect(data.first).to.be(true);
            expect(data.socket.user).to.eql(user);
        });
        connectSocket(
            function onConnect(sock) {
                sock.write(JSON.stringify({
                    type: "auth",
                    args: {id: user.id, key: user.getSockKey()}
                }));
            },
            function onData(sock, data) {
                mgr.destroy();
                if (data.type == "auth-ack") {
                    done();
                } else {
                    done(new Error(data));
                }
            }
        );
    });

    function refuseAuth(user, authMsg, done) {
        var mgr = new RoomManager(socketServer, users);
        mgr.on("auth", function(data) { done(new Error("Shouldn't've authed.")); });
        connectSocket(
            function onConnect(sock) {
                sock.write(JSON.stringify(authMsg));
            },
            function onData(sock, data) {
                mgr.destroy();
                sock.close();
                if (data.type == "auth-err") {
                    done();
                } else {
                    done(new Error(data));
                }
           }
        );
    }
    it("Refuses auth without ID", function(done) {
        var user = users.at(0);
        refuseAuth(user, {type: "auth", args: {key: user.getSockKey()}}, done);
    });
    it("Refuses auth with non-matching ID", function(done) {
        var user = users.at(0),
            user2 = users.at(1);
        refuseAuth(user, {type: "auth", args: {id: user2.id, key: user.getSockKey()}}, done);
    });
    it("Refuses auth without Key", function(done) {
        var user = users.at(0);
        refuseAuth(user, {type: "auth", args: {id: user.id}}, done);
    });
    it("Refuses auth with non-matching key", function(done) {
        var user = users.at(0),
            user2 = users.at(1);
        refuseAuth(user, {type: "auth", args: {id: user.id, key: user2.getSockKey()}}, done);
    });
    it("Refuses auth with bogus key", function(done) {
        var user = users.at(0);
        refuseAuth(user, {type: "auth", args: {id: user.id, key: "bogus"}}, done);
    });

    /*
    * This gets a little gnarly and nested -- but it's equally hairy to try to
    * figure out how to wrap this into an async style chain.  A promise-style
    * chain is probably ideal, but .....
    */
    it("Joining and leaving rooms", function(done) {
        var user = users.at(0);
        var user2 = users.at(1);
        var mgr = new RoomManager(socketServer, users);
        var sock1, sock2, sock3;
        // Expectations with one socket from `user` in the room.
        function expectOne(args) {
            expect(mgr.roomToSockets).to.eql({"someroom": [args.socket]});

            var socketIdToRooms = {};
            socketIdToRooms[args.socket.id] = ["someroom"];
            expect(mgr.socketIdToRooms).to.eql(socketIdToRooms);

            expect(mgr.roomToUsers).to.eql({"someroom": [user]});
            expect(mgr.socketBindings[args.socket.id]).to.not.be(undefined);
        }
        // Expectations with two sockets from `user` in the room. 
        function expectTwo(args) {
            expect(mgr.roomToSockets.someroom.length).to.be(2);
            expect(_.contains(mgr.roomToSockets.someroom, args.socket)).to.be(true);

            expect(_.size(mgr.socketIdToRooms)).to.be(2);
            expect(mgr.socketIdToRooms[args.socket.id]).to.eql(["someroom"]);

            expect(mgr.userIdToSockets[user.id].length).to.be(2);
            expect(_.contains(mgr.userIdToSockets[user.id], args.socket)).to.be(true);

            expect(mgr.socketIdToUser[args.socket.id]).to.eql(user);

            expect(mgr.roomToUsers).to.eql({"someroom": [user]});
            expect(mgr.socketBindings[args.socket.id]).to.not.be(undefined);
        }
        // Expectations with two sockets from `user` and one from `user2` in the room.
        function expectThree(args) {
            expect(mgr.roomToSockets.someroom.length).to.be(3);
            expect(_.contains(mgr.roomToSockets.someroom, args.socket)).to.be(true);
            expect(_.size(mgr.socketIdToRooms)).to.be(3);
            expect(mgr.socketIdToRooms[args.socket.id]).to.eql(["someroom"]);
            expect(_.size(mgr.userIdToSockets)).to.be(2);
            expect(mgr.userIdToSockets[user2.id]).to.eql([args.socket]);
            expect(mgr.socketIdToUser[args.socket.id]).to.eql(user2);
            expect(mgr.roomToUsers.someroom.length).to.be(2);
            expect(_.contains(mgr.roomToUsers.someroom, user)).to.be(true);
            expect(mgr.socketBindings[args.socket.id]).to.not.be(undefined);
        }
        // The first socket joins a room.
        authedSocket(user, function(sock) {
            sock.write(JSON.stringify({type: "join", args: {id: "someroom"}}));
            sock.on("data", function(message) {
                var data = JSON.parse(message);
                expect(data.type).to.be("join-ack");
            });
            sock1 = sock;
        });
        mgr.once("join", function(args) {
            expect(args.socket.user.id).to.eql(user.id); // we are authed
            expect(args.roomFirst).to.be(true); // we're the first in this room
            expect(args.userFirst).to.be(true); // This is our first socket in the room.
            expectOne(args);

            // At this point, mgr.userIdToSockets only contains ourselves.
            var userIdToSockets = {};
            userIdToSockets[user.id] = [args.socket];
            expect(mgr.userIdToSockets).to.eql(userIdToSockets);

            // ... as does mgr.socketIdToUser.
            var socketIdToUser = {};
            socketIdToUser[args.socket.id] = user;
            expect(mgr.socketIdToUser).to.eql(socketIdToUser);
            
            // Join a second socket from the same user.
            authedSocket(user, function(sock) {
                sock.write(JSON.stringify({type: "join", args: {id: "someroom"}}));
                sock.once("data", function(message) {
                    var data = JSON.parse(message);
                    expect(data.type).to.be("join-ack");
                });
                sock2 = sock;
            });
            mgr.once("join", function(args2) {
                expect(args2.socket.user.id).to.eql(user.id);
                expect(args2.userFirst).to.be(false); // This is our 2nd sock in this room.
                expect(args2.roomFirst).to.be(false); // and the 2nd sock in the room, period.
                expectTwo(args2);

                // Join a third socket from a different user.
                authedSocket(user2, function(sock) {
                    sock.write(JSON.stringify({type: "join", args: {id: "someroom"}}));
                    sock.once("data", function(message) {
                        var data = JSON.parse(message);
                        expect(data.type).to.be("join-ack");
                    });
                    sock3 = sock;
                });
                mgr.once("join", function(args3) {
                    expect(args3.socket.user.id).to.eql(user2.id);
                    expect(args3.roomId).to.be("someroom");
                    expect(args3.userFirst).to.be(true); // user2's first sock
                    expect(args3.roomFirst).to.be(false); // but the room's third
                    expectThree(args3);

                    expect(mgr.getUsers("someroom")).to.eql([user, user2]);

                    // Third socket leaves by "leave" message.
                    sock3.write(JSON.stringify({type: "leave", args: {id: "someroom"}}));
                    mgr.once("leave", function(args4) {
                        expect(args4.roomId).to.be("someroom");
                        expect(args4.socket).to.eql(args3.socket);
                        expect(args4.userLast).to.be(true);
                        expect(args4.roomLast).to.be(false);

                        sock3.once("data", function(message) {
                            expect(JSON.parse(message).type).to.eql("leave-ack");

                            expectTwo(args2);

                            // Second socket leaves by disconnect.
                            sock2.close();
                            mgr.once("leave", function(args5) {
                                expectOne(args);
                                expect(args5.roomId).to.be("someroom");
                                expect(args5.socket).to.eql(args2.socket);
                                // Still have another socket in this room from this user..
                                expect(args5.roomLast).to.be(false);
                                expect(args5.userLast).to.be(false);

                                sock1.close();
                                mgr.once("leave", function(args6) {
                                    expect(args6.roomId).to.eql("someroom");
                                    expect(args6.socket).to.eql(args.socket);
                                    expect(args6.roomLast).to.be(true);
                                    expect(args6.userLast).to.be(true);

                                    expect(_.size(mgr.roomToSockets)).to.be(0);
                                    expect(_.size(mgr.socketIdToRooms)).to.be(0);
                                    // Only one socket didn't disconnect -- it's still authed.
                                    expect(_.size(mgr.socketIdToUser)).to.be(1);
                                    expect(_.size(mgr.userIdToSockets)).to.be(1);
                                    expect(_.values(mgr.userIdToSockets).length).to.be(1);
                                    expect(_.size(mgr.roomToUsers)).to.be(0);

                                    mgr.destroy();
                                    args.socket.close();
                                    sock3.close();
                                    done();
                                });
                            });
                        });
                    });
                });
            });
        });
    });


    it("Fires disconnect for unauthenticated users", function(done) {
        var mgr = new RoomManager(socketServer, users);
        var user = users.at(0);
        var sock;
        connectSocket(
            function onConnect(theSock) {
                sock = theSock;
                sock.close(); // Disconnect
            },
            function onData(sock, data) {
                // Don't expect any data...
                throw new Error(data);
            }
        )
        mgr.on("disconnect", function(args) {
            expect(args.authenticated).to.be(false);
            expect(args.last).to.be(null);
            mgr.destroy();
            done();
        });
    });

    it("Fires disconnect for authenticated users", function(done) {
        var mgr = new RoomManager(socketServer, users);
        var user = users.at(0);
        authedSocket(user, function(sock1) {
            authedSocket(user, function(sock2) {
                sock1.close();
                mgr.once("disconnect", function(args) {
                    expect(args.authenticated).to.be(true);
                    expect(args.last).to.be(false);
                    sock2.close();
                    mgr.once("disconnect", function(args) {
                        expect(args.authenticated).to.be(true);
                        expect(args.last).to.be(true);
                        mgr.destroy();
                        done();
                    });
                });
            });
        });
    });

    function roomSocket(user, room, callback) {
        authedSocket(user, function(sock) {
            sock.write(JSON.stringify({type: "join", args: {id: room}}));
            sock.once("data", function(message) {
                expect(JSON.parse(message).type).to.eql("join-ack");
                callback(sock);
            });
        });
    }

    it("Broadcasts to rooms", function(done) {
        var mgr = new RoomManager(socketServer, users);
        var user1 = users.at(0);
        var user2 = users.at(1);
        var data = {doge: "wow"};
        roomSocket(user1, "funroom", function(sock1) {
            roomSocket(user1, "funroom", function(sock2) {
                roomSocket(user2, "funroom", function(sock3) {
                    expect(mgr.roomToSockets.funroom.length).to.be(3);
                    sock1.on("data", function(message) {
                        throw new Error("Shouldn't have gotten data");
                    });
                    async.parallel([
                        function(done) {
                            sock2.once("data", function(message) {
                                expect(JSON.parse(message)).to.eql(data);
                                done();
                            });
                        },
                        function(done) {
                            sock3.once("data", function(message) {
                                expect(JSON.parse(message)).to.eql(data);
                                done();
                            });
                        }
                    ], function() {
                        mgr.destroy();
                        sock1.close();
                        sock2.close();
                        sock3.close();
                        done();
                    });
                    // broadcast to everyone but sock1.
                    mgr.broadcast('funroom', data, mgr.userIdToSockets[user1.id][0]);
                });
            });
        });
      
    });

    it("Restricts joining with channel auth", function(done) {
        var mgr = new RoomManager(socketServer, users);
        var regular = users.findWhere({admin: false});
        var admin = users.findWhere({admin: true});
        // Create an authorization function on the "admin" channel, which
        // checks that a user is authenticated and has an 'admin' bit.
        mgr.channelAuth.admin = function(socket, room, callback) {
            var authorized = socket.user && socket.user.get("admin") === true;
            callback(null, authorized);
        };
        // Try to join a room in "admin":
        async.parallel([
            // Join as a non-admin user that won't be authorized.
            function(done) {
                authedSocket(regular, function(sock) {
                    sock.write(JSON.stringify({type: "join", args: {id: "admin/1"}}));
                    sock.once("data", function(message) {
                        var data = JSON.parse(message);
                        expect(data.type).to.be("join-err");
                        expect(data.args).to.be("Permission to join admin/1 denied.");
                        sock.close();
                        done();
                    });
                });
            },
            // Join as an admin user that will be authorized.
            function(done) {
                authedSocket(admin, function(sock) {
                    sock.write(JSON.stringify({type: "join", args: {id: "admin/1"}}));
                    sock.once("data", function(message) {
                        var data = JSON.parse(message);
                        expect(data.type).to.be("join-ack");
                        sock.close();
                        done();
                    });
                });
            }
        ], function() {
            mgr.destroy();
            done();
        });
    });
});

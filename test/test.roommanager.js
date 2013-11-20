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
    before(function() {
        socketServer.installHandlers(server, {prefix: '/sock'});
        server.listen(7777, '0.0.0.0');
    });
    after(function() {
        server.close();
    });
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
        function expectOne(socket, args) {
            expect(mgr.roomToSockets).to.eql({"someroom": [socket]});

            var socketIdToRooms = {};
            socketIdToRooms[socket.id] = ["someroom"];
            expect(mgr.socketIdToRooms).to.eql(socketIdToRooms);

            expect(mgr.roomToUsers).to.eql({"someroom": [user]});
            expect(mgr.socketBindings[socket.id]).to.not.be(undefined);
        }
        // Expectations with two sockets from `user` in the room. 
        function expectTwo(socket, args) {
            expect(mgr.roomToSockets.someroom.length).to.be(2);
            expect(_.contains(mgr.roomToSockets.someroom, socket)).to.be(true);

            expect(_.size(mgr.socketIdToRooms)).to.be(2);
            expect(mgr.socketIdToRooms[socket.id]).to.eql(["someroom"]);

            expect(mgr.userIdToSockets[user.id].length).to.be(2);
            expect(_.contains(mgr.userIdToSockets[user.id], socket)).to.be(true);

            expect(mgr.socketIdToUser[socket.id]).to.eql(user);

            expect(mgr.roomToUsers).to.eql({"someroom": [user]});
            expect(mgr.socketBindings[socket.id]).to.not.be(undefined);
        }
        // Expectations with two sockets from `user` and one from `user2` in the room.
        function expectThree(socket, args) {
            expect(mgr.roomToSockets.someroom.length).to.be(3);
            expect(_.contains(mgr.roomToSockets.someroom, socket)).to.be(true);
            expect(_.size(mgr.socketIdToRooms)).to.be(3);
            expect(mgr.socketIdToRooms[socket.id]).to.eql(["someroom"]);
            expect(_.size(mgr.userIdToSockets)).to.be(2);
            expect(mgr.userIdToSockets[user2.id]).to.eql([socket]);
            expect(mgr.socketIdToUser[socket.id]).to.eql(user2);
            expect(mgr.roomToUsers.someroom.length).to.be(2);
            expect(_.contains(mgr.roomToUsers.someroom, user)).to.be(true);
            expect(mgr.socketBindings[socket.id]).to.not.be(undefined);
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
        mgr.once("join", function(socket, args) {
            expect(socket.user.id).to.eql(user.id); // we are authed
            expect(args.roomFirst).to.be(true); // we're the first in this room
            expect(args.userFirst).to.be(true); // This is our first socket in the room.
            expectOne(socket, args);

            // At this point, mgr.userIdToSockets only contains ourselves.
            var userIdToSockets = {};
            userIdToSockets[user.id] = [socket];
            expect(mgr.userIdToSockets).to.eql(userIdToSockets);

            // ... as does mgr.socketIdToUser.
            var socketIdToUser = {};
            socketIdToUser[socket.id] = user;
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
            mgr.once("join", function(socket2, args2) {
                expect(socket2.user.id).to.eql(user.id);
                expect(args2.userFirst).to.be(false); // This is our 2nd sock in this room.
                expect(args2.roomFirst).to.be(false); // and the 2nd sock in the room, period.
                expectTwo(socket2, args2);

                // Join a third socket from a different user.
                authedSocket(user2, function(sock) {
                    sock.write(JSON.stringify({type: "join", args: {id: "someroom"}}));
                    sock.once("data", function(message) {
                        var data = JSON.parse(message);
                        expect(data.type).to.be("join-ack");
                    });
                    sock3 = sock;
                });
                mgr.once("join", function(socket3, args3) {
                    expect(socket3.user.id).to.eql(user2.id);
                    expect(args3.roomId).to.be("someroom");
                    expect(args3.userFirst).to.be(true); // user2's first sock
                    expect(args3.roomFirst).to.be(false); // but the room's third
                    expectThree(socket3, args3);

                    expect(mgr.getUsers("someroom")).to.eql([user, user2]);

                    // Third socket leaves by "leave" message.
                    sock3.write(JSON.stringify({type: "leave", args: {id: "someroom"}}));
                    mgr.once("leave", function(socket4, args4) {
                        expect(args4.roomId).to.be("someroom");
                        expect(socket4).to.eql(socket3);
                        expect(args4.userLast).to.be(true);
                        expect(args4.roomLast).to.be(false);

                        sock3.once("data", function(message) {
                            expect(JSON.parse(message).type).to.eql("leave-ack");

                            expectTwo(socket2, args2);

                            // Second socket leaves by disconnect.
                            sock2.close();
                            mgr.once("leave", function(socket5, args5) {
                                expectOne(socket, args);
                                expect(args5.roomId).to.be("someroom");
                                expect(socket5).to.eql(socket2);
                                // Still have another socket in this room from this user..
                                expect(args5.roomLast).to.be(false);
                                expect(args5.userLast).to.be(false);

                                sock1.close();
                                mgr.once("leave", function(socket6, args6) {
                                    expect(args6.roomId).to.eql("someroom");
                                    expect(socket6).to.eql(socket);
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
                                    socket.close();
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
        mgr.on("disconnect", function(socket, args) {
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
                mgr.once("disconnect", function(socket, args) {
                    expect(args.authenticated).to.be(true);
                    expect(args.last).to.be(false);
                    sock2.close();
                    mgr.once("disconnect", function(socket, args) {
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
        var data = {type: "doge", args: {so: "wow"}};
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
                    mgr.broadcast('funroom', data.type, data.args,
                                  mgr.userIdToSockets[user1.id][0]);
                });
            });
        });
      
    });

    it("Restricts joining with channel auth", function(done) {
        var mgr = new RoomManager(socketServer, users);
        var regular = users.findWhere({superuser: false});
        var superuser = users.findWhere({superuser: true});
        // Create an authorization function on the "superuser" channel, which
        // checks that a user is authenticated and is a superuser.
        mgr.channelAuth.superuser = function(socket, room, callback) {
            var authorized = socket.user && socket.user.isSuperuser();
            callback(null, authorized);
        };
        // Try to join a room in "superuser":
        async.parallel([
            // Join as a non-superuser that won't be authorized.
            function(done) {
                authedSocket(regular, function(sock) {
                    sock.write(JSON.stringify({type: "join", args: {id: "superuser/1"}}));
                    sock.once("data", function(message) {
                        var data = JSON.parse(message);
                        expect(data.type).to.be("join-err");
                        expect(data.args).to.be("Permission to join superuser/1 denied.");
                        sock.close();
                        done();
                    });
                });
            },
            // Join as a superuser that will be authorized.
            function(done) {
                authedSocket(superuser, function(sock) {
                    sock.write(JSON.stringify({type: "join", args: {id: "superuser/1"}}));
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
    it("determines if a room contains a socket", function(done) {
        var user1 = users.at(0),
            user2 = users.at(1);
        var mgr = new RoomManager(socketServer, users);
        roomSocket(user1, "funroom", function(clientSock1) {
            roomSocket(user2, "funroom", function(clientSock2) {
                authedSocket(user2, function(clientSock3) {
                    expect(
                        mgr.roomContainsSocket("funroom", mgr.userIdToSockets[user1.id][0])
                    ).to.be(true);
                    expect(
                        mgr.roomContainsSocket("funroom", mgr.userIdToSockets[user2.id][0])
                    ).to.be(true);
                    expect(
                        mgr.roomContainsSocket("funroom", mgr.userIdToSockets[user2.id][1])
                    ).to.be(false);
                    mgr.destroy();
                    clientSock1.close();
                    clientSock2.close();
                    clientSock3.close();
                    done();
                });
            });
        });


    });
});

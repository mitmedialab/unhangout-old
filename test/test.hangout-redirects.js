var server = require("../lib/unhangout-server"),
    models = require("../lib/server-models"),
    farming = require("../lib/hangout-farming"),
    common = require("./common"),
    expect = require("expect.js"),
    _ = require("underscore"),
    request = require("superagent"),
    sinon = require('sinon'),
    async = require('async');

describe("HANGOUT REDIRECTS", function() {
    var event;
    var session;
    var suffix;

    after(function() {
      // Manually restore timers, in case sinon screwed it up.  Ideally, we
      // will have restored them in the functions themselves, each time we've
      // used them.
      common.restoreTimers();
    });

    beforeEach(function(done) {
        common.standardSetup(function() {
            // Grab a session to work with.
            common.server.db.events.any(function(e) {
                event = e;
                if (e.get("sessions").length > 0) {
                    e.set("open", true);
                    session = e.get("sessions").at(0);
                    suffix = function(sockKey, sess) {
                        sess = sess || session;
                        var user = common.server.db.users.findWhere({"sock-key": sockKey});
                        return "?gid=rofl&gd=sessionId:" + sess.id +
                            ":sockKey:" + sockKey + ":userId:" + user.id;
                    }
                    return true;
                }
            });
            if (!session) {
                console.log("error", common.server.db.events.toJSON());
                throw new Error("No sessions loaded!");
            }
            done();
        });
    });
    afterEach(common.standardShutdown);

    function checkRedirect(expected, user, done) {
        // Set node environment to production.  In development/testing
        // environments, redirects point to our mocked hangout rather than the
        // real thing.  Here, we want to check the real thing.
        var origNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        request.get(common.URL + session.getParticipationLink())
            .timeout(models.ServerSession.prototype.HANGOUT_CREATION_TIMEOUT + 2)
            .set("x-mock-user", user)
            .redirects(0)
            .end(function(res) {
                // Restore node environment so we don't mess up the rest of the
                // tests.
                process.env.NODE_ENV = origNodeEnv;
                expect(res.status).to.be(302);
                expect(res.headers.location).to.be(expected);
                done();
            });
    }

    it("Renders error page when the hangout is full", function(done) {
        session.set("connectedParticipants", [
            {id: "u0", displayName: "U0", picture: ""},
            {id: "u1", displayName: "U1", picture: ""},
            {id: "u2", displayName: "U2", picture: ""},
            {id: "u3", displayName: "U3", picture: ""},
            {id: "u4", displayName: "U4", picture: ""},
        ]);
        session.set("joiningParticipants", [
            {id: "u5", displayName: "U5", picture: ""},
            {id: "u6", displayName: "U6", picture: ""},
            {id: "u7", displayName: "U7", picture: ""},
            {id: "u8", displayName: "U8", picture: ""},
            {id: "u9", displayName: "U9", picture: ""},
        ]);
        request.get(common.URL + session.getParticipationLink())
            .set("x-mock-user", "regular1")
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(200);
                expect(res.text).to.contain("Session full");
                done();
            });
    });

    describe("HoA REDIRECT", function() {
        var hoa;
        beforeEach(function() {
            hoa = new models.ServerHoASession({id: "t1"});
            event.set("hoa", hoa);
        });


        it("Session router redirects to hoa-session for HoAs", function(done) {
            request.get(common.URL + "/session/" + hoa.get("session-key"))
                .set("x-mock-user", "regular1")
                .redirects(0)
                .end(function(res) {
                    expect(res.status).to.be(302);
                    expect(res.headers.location).to.be(
                        "/hoa-session/" + hoa.get("session-key")
                    )
                    done();
                });
        });
        it("redirects to regular session if it isn't an hoa", function(done) {
            request.get(common.URL + "/hoa-session/" + session.get("session-key"))
                .set("x-mock-user", "regular1")
                .redirects(0)
                .end(function(res) {
                    expect(res.status).to.be(302);
                    expect(res.headers.location).to.be(
                        "/session/" + session.get("session-key")
                    )
                    done();
                });
        });
        it("gives forbiden for non-admins", function(done) {
            request.get(common.URL + hoa.getParticipationLink())
                .set("x-mock-user", "regular1")
                .redirects(0)
                .end(function(res) {
                    expect(res.status).to.be(403);
                    done();
                });
        });
        it("uses existing URL if present", function(done) {
            hoa.set("hangout-url", "http://example.com/hoastic");
            request.get(common.URL + hoa.getParticipationLink())
                .set("x-mock-user", "superuser1")
                .redirects(0)
                .end(function(res) {
                    expect(res.status).to.be(302);
                    expect(res.headers.location).to.be(
                        "http://example.com/hoastic" + suffix("superuser1", hoa)
                    );
                    done();
                });
        });

        it("renders hangout-pending if it is", function(done) {
            var u = common.server.db.users.findWhere({"sock-key": "admin1"});

            var clock = sinon.useFakeTimers(0, "setTimeout", "setInterval");
            hoa.markHangoutPending(u);

            clock.tick(hoa.HANGOUT_CREATION_TIMEOUT / 2);
            clock.restore();

            request.get(common.URL + hoa.getParticipationLink())
                .set("x-mock-user", "superuser1")
                .redirects(0)
                .end(function(res) {
                    expect(res.status).to.be(200);
                    expect(res.text).to.contain(
                        "Hangout-on-air creation already started"
                    );
                    clock.tick(hoa.HANGOUT_CREATION_TIMEOUT / 2 + 1);
                    // After timeout shows create-hoa.
                    request.get(common.URL + hoa.getParticipationLink())
                        .set("x-mock-user", "superuser1")
                        .redirects(0)
                        .end(function(res) {
                            expect(res.status).to.be(200);
                            expect(res.text).to.contain("Create Hangout-on-air?");
                            clock.restore()
                            // Sinon restore doesn't behave correctly with superagent
                            // request callbacks. Manually restore timers.
                            //_.extend(global, timers);
                            done();
                        });
                });

        });

        it("renders create-hoa if there's no URL", function(done) {
            request.get(common.URL + hoa.getParticipationLink())
                .set("x-mock-user", "superuser1")
                .redirects(0)
                .end(function(res) {
                    expect(res.status).to.be(200);
                    expect(res.text).to.contain("Create Hangout-on-air?");
                    done();
                });
        });
    });
});

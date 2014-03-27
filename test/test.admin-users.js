var server = require('../lib/unhangout-server'),
    models = require('../lib/server-models'),
    expect = require('expect.js'),
    _ = require('underscore')._,
    request = require('superagent'),
    common = require('./common');

var sock;
var session;

describe("HTTP ADMIN USERS API", function() {
    beforeEach(common.standardSetup);
    afterEach(common.standardShutdown);

    function postUsers(user, body, callback) {
        request.post("http://localhost:7777/admin/users/")
            .set("x-mock-user", user)
            .send(body)
            .redirects(0)
            .end(callback);
    }

    it("allows GET from superusers", function(done) {
        request.get("http://localhost:7777/admin/users/")
            .set("x-mock-user", "superuser1")
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(200);
                done();
            });
    });
    it("denies GET from non-superusers", function(done) {
        request.get("http://localhost:7777/admin/users/")
            .set("x-mock-user", "admin1")
            .redirects(0)
            .end(function(res) {
                expect(res.status).to.be(401);
                done();
            });
    });
    it("denies POST from non-superusers", function(done) {
        postUsers("admin1", {userId: 1, action: "set-superuser"}, function(res) {
            expect(res.status).to.be(403);
            done();
        });
    });

    it("rejects requests without `action` param", function(done) {
        postUsers("superuser1", {userId: 1, email: "fun@example.com"}, function(res) {
            expect(res.status).to.be(400);
            done();
        });
    });
    it("sets superuser status by id", function(done) {
        var user = common.server.db.users.findWhere({superuser: false});
        expect(user.get("superuser")).to.be(false);
        postUsers("superuser1", {
            userId: user.id,
            action: "set-superuser",
            superuser: true
        }, function(res) {
            expect(res.status).to.be(200);
            expect(common.server.db.users.get(user.id).get("superuser")).to.be(true);
            done()
        });
    });
    it("unsets superuser status by id", function(done) {
        var user = common.server.db.users.findWhere({superuser: true});
        expect(user.get("superuser")).to.be(true);
        postUsers("superuser1", {
            userId: user.id,
            action: "set-superuser",
            superuser: false
        }, function(res) {
            expect(res.status).to.be(200);
            expect(common.server.db.users.get(user.id).get("superuser")).to.be(false);
            done()
        });
    });
    it("sets superuser status by email", function(done) {
        var user = common.server.db.users.findByEmail("regular1@example.com");
        expect(user).to.not.be(undefined);
        expect(user.get("superuser")).to.be(false);
        postUsers("superuser1", {
            email: "regular1@example.com",
            action: "set-superuser",
            superuser: true
        }, function(res) {
            expect(res.status).to.be(200);
            expect(common.server.db.users.get(user.id).get("superuser")).to.be(true);
            done()
        });
    });
    it("unsets superuser status by email", function(done) {
        var user = common.server.db.users.findByEmail("superuser1@example.com");
        expect(user).to.not.be(undefined);
        expect(user.get("superuser")).to.be(true);
        postUsers("superuser1", {
            email: "superuser1@example.com",
            action: "set-superuser",
            superuser: false
        }, function(res) {
            expect(res.status).to.be(200);
            expect(common.server.db.users.get(user.id).get("superuser")).to.be(false);
            done()
        });
    });
    it("rejects request to grant superuser to unknown email", function(done) {
        var user = common.server.db.users.findByEmail("newone@example.com");
        expect(user).to.be(undefined);
        postUsers("superuser1", {
            email: "newone@example.com",
            action: "set-superuser",
            superuser: true
        }, function(res) {
            expect(res.status).to.be(400);
            expect(res.text).to.be("Unknown user");
            var newUser = common.server.db.users.findByEmail("newone@example.com");
            expect(newUser).to.be(undefined);
            done()
        });
    });

    it("adds event admins by id", function(done) {
        var user = common.server.db.users.findByEmail("regular1@example.com");
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        expect(user.isAdminOf(event)).to.be(false);
        postUsers("superuser1", {
            action: "add-event-admin",
            userId: user.id,
            eventId: event.id
        }, function(res) {
            expect(res.status).to.be(200);
            expect(user.isAdminOf(event)).to.be(true);
            expect(user.adminCache[event.id]).to.be(true);
            done();
        });
    });
    it("removes event admins by id", function(done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        var user = common.server.db.users.findByEmail(event.get("admins")[0].email);
        event.set("admins", [{id: user.id}]);

        expect(user.isAdminOf(event)).to.be(true);
        postUsers("superuser1", {
            action: "remove-event-admin",
            userId: user.id,
            eventId: event.id
        }, function(res) {
            expect(res.status).to.be(200);
            expect(user.isAdminOf(event)).to.be(false);
            expect(user.adminCache[event.id]).to.be(undefined);
            expect(event.get("admins")).to.eql([]);
            done();
        });
    });
    it("adds event admins by known email", function(done) {
        var user = common.server.db.users.findByEmail("regular1@example.com");
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        expect(user.isAdminOf(event)).to.be(false);
        postUsers("superuser1", {
            action: "add-event-admin",
            email: user.get("emails")[0].value,
            eventId: event.id
        }, function(res) {
            expect(res.status).to.be(200);
            expect(user.isAdminOf(event)).to.be(true);
            expect(user.adminCache[event.id]).to.be(true);
            done();
        });
    });
    it("removes event admins by known email", function(done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        var email = event.get("admins")[0].email;
        var user = common.server.db.users.findByEmail(email);

        expect(user.isAdminOf(event)).to.be(true);
        postUsers("superuser1", {
            action: "remove-event-admin",
            email: email,
            eventId: event.id
        }, function(res) {
            expect(res.status).to.be(200);
            expect(user.isAdminOf(event)).to.be(false);
            expect(user.adminCache[event.id]).to.be(undefined);
            expect(event.get("admins")).to.eql([]);
            done()
        });
    });
    it("adds event admins by unknown email", function(done) {
        var user = common.server.db.users.findByEmail("nonexistent@example.com");
        expect(user).to.be(undefined);
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        event.set("admins", []);
        postUsers("superuser1", {
            action: "add-event-admin",
            email: "nonexistent@example.com",
            eventId: event.id
        }, function(res) {
            expect(res.status).to.be(200);
            var user = new models.ServerUser({emails: [{value: "nonexistent@example.com"}]});
            expect(user.isAdminOf(event)).to.be(true)

            // No admin cache unless the user is added to our list of users.
            expect(user.adminCache[event.id]).to.be(undefined);
            common.server.db.users.add(user);
            expect(user.adminCache[event.id]).to.be(true);
            common.server.db.users.remove(user);

            done()
        });
    });
    it("removes event admins by unknown email", function(done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        event.set("admins", [{email: "nonexistent@example.com"}]);
        expect(new models.ServerUser({emails: [{value: "nonexistent@example.com"}]}).isAdminOf(event)).to.be(true);

        postUsers("superuser1", {
            action: "remove-event-admin",
            email: "nonexistent@example.com",
            eventId: event.id
        }, function(res) {
            expect(res.status).to.be(200);
            var user = new models.ServerUser({emails: [{value: "nonexistent@example.com"}]})
            expect(event.get("admins")).to.eql([]);
            expect(user.isAdminOf(event)).to.be(false);

            // No cache -- never been populated...
            expect(user.adminCache[event.id]).to.be(undefined);
            common.server.db.users.add(user);
            // but even after population, isn't filled, cause we're no longer admin.
            expect(user.adminCache[event.id]).to.be(undefined);
            common.server.db.users.remove(user);

            done();
        });
    });
    it("removes event admins by email when they were added by id", function(done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        var user = common.server.db.users.findWhere({superuser: false});
        event.set("admins", [{id: user.id}]);
        expect(user.isAdminOf(event)).to.be(true);
        // Make sure it has an email set...
        expect(!!user.get('emails')[0].value).to.be(true);

        postUsers("superuser1", {
            action: "remove-event-admin",
            email: user.get('emails')[0].value,
            eventId: event.id
        }, function(res) {
            expect(res.status).to.be(200);
            expect(user.isAdminOf(event)).to.be(false);
            expect(user.adminCache[event.id]).to.be(undefined);
            expect(event.get("admins")).to.eql([]);
            done();
        });
    });
    it("removes event admins by id when they were added by email", function(done) {
        var event = common.server.db.events.findWhere({shortName: "writers-at-work"});
        var user = common.server.db.users.findWhere({superuser: false});
        event.set("admins", [{email: user.get('emails')[0].value}]);
        expect(user.isAdminOf(event)).to.be(true);
        postUsers("superuser1", {
            action: "remove-event-admin",
            userId: user.id,
            eventId: event.id
        }, function(res) {
            expect(res.status).to.be(200);
            expect(user.isAdminOf(event)).to.be(false);
            expect(user.adminCache[event.id]).to.be(undefined);
            expect(event.get("admins")).to.eql([]);
            done();
        });
    });

    it("Perms: returns false for undefined perms", function() {
        var user = common.server.db.users.findWhere({perms: undefined, superuser: false});
        expect(user.get("perms")).to.be(undefined);
        expect(user.hasPerm("createEvents")).to.be(false);
    });

    it("Perms: rejects requests from non-superusers", function(done) {
        var user = common.server.db.users.findWhere({superuser: false});
        postUsers("admin1", {
            action: "set-perms",
            perms: JSON.stringify({createEvents: true})
        }, function(res) {
            expect(res.status).to.be(403);
            expect(res.text).to.be("Forbidden");
            expect(user.hasPerm("createEvents")).to.be(false);
            done();
        });

    });
    it("Perms: rejects unknown permissions", function(done) {
        var user = common.server.db.users.findWhere({superuser: false});
        expect(user.hasPerm("blah")).to.be(false);
        postUsers("superuser1", {
            action: "set-perms",
            userId: user.id,
            perms: JSON.stringify({blah: true})
        }, function(res) {
            expect(res.status).to.be(400);
            expect(res.text).to.be("Perms not recognized: blah");
            expect(user.hasPerm("blah")).to.be(false);
            done();
        });
    });
    it("Perms: rejects missing perms parameter", function(done) {
        var user = common.server.db.users.findWhere({superuser: false});
        expect(user.hasPerm("createEvents")).to.be(false);
        postUsers("superuser1", {
            action: "set-perms",
            userId: user.id,
        }, function(res) {
            expect(res.status).to.be(400);
            expect(res.text).to.be("Missing `perms` parameter.");
            expect(user.hasPerm("createEvents")).to.be(false);
            done();
        });
    });
    it("Perms: rejects bad JSON without crash", function(done) {
        var user = common.server.db.users.findWhere({superuser: false});
        expect(user.hasPerm("createEvents")).to.be(false);
        postUsers("superuser1", {
            action: "set-perms",
            userId: user.id,
            perms: "{createEvents: true"
        }, function(res) {
            expect(res.status).to.be(400);
            expect(res.text).to.be("Bad JSON for `perms` parameter.");
            expect(user.hasPerm("createEvents")).to.be(false);
            done();
        });
    });
    it("Perms: rejects unknown user", function(done) {
        var user = common.server.db.users.findWhere({superuser: false});
        expect(user.hasPerm("createEvents")).to.be(false);
        postUsers("superuser1", {
            action: "set-perms",
            userId: "nonexistent",
            perms: JSON.stringify({createEvents: true})
        }, function(res) {
            expect(res.status).to.be(400);
            expect(res.text).to.be("Unrecognized user");
            expect(user.hasPerm("createEvents")).to.be(false);
            done();
        });
    });
    it("Perms: sets `createEvents` with well-formed request", function(done) {
        var user = common.server.db.users.findWhere({superuser: false});
        expect(user.hasPerm("createEvents")).to.be(false);
        postUsers("superuser1", {
            action: "set-perms",
            userId: user.id,
            perms: JSON.stringify({createEvents: true})
        }, function(res) {
            expect(res.text).to.be("OK");
            expect(res.status).to.be(200);
            expect(user.hasPerm("createEvents")).to.be(true);
            done();
        });
    });
    it("Perms: unsets `createEvents` with well-formed request", function(done) {
        var user = common.server.db.users.findWhere({superuser: false});
        user.setPerm("createEvents", true);
        expect(user.hasPerm("createEvents")).to.be(true);
        postUsers("superuser1", {
            action: "set-perms",
            userId: user.id,
            perms: JSON.stringify({createEvents: false})
        }, function(res) {
            expect(res.text).to.be("OK");
            expect(res.status).to.be(200);
            expect(user.hasPerm("createEvents")).to.be(false);
            done();
        });
    });
});

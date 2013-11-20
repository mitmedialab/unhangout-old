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
                expect(res.status).to.be(302);
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
    it("creates user for unknown email with superuser", function(done) {
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
        var event = common.server.db.events.at(0);
        expect(user.isAdminOf(event)).to.be(false);
        postUsers("superuser1", {
            action: "add-admin",
            userId: user.id,
            eventId: event.id
        }, function(res) {
            expect(res.status).to.be(200);
            expect(user.isAdminOf(event)).to.be(true)
            done()
        });
    });
    it("removes event admins by id", function(done) {
        var event = common.server.db.events.at(0);
        var user = common.server.db.users.findByEmail(event.get("admins")[0].email);
        event.set("admins", [{id: user.id}]);

        expect(user.isAdminOf(event)).to.be(true);
        postUsers("superuser1", {
            action: "remove-admin",
            userId: user.id,
            eventId: event.id
        }, function(res) {
            expect(res.status).to.be(200);
            expect(user.isAdminOf(event)).to.be(false);
            expect(event.get("admins")).to.eql([]);
            done()
        });
    });
    it("adds event admins by known email", function(done) {
        var user = common.server.db.users.findByEmail("regular1@example.com");
        var event = common.server.db.events.at(0);
        expect(user.isAdminOf(event)).to.be(false);
        postUsers("superuser1", {
            action: "add-admin",
            email: user.get("emails")[0].value,
            eventId: event.id
        }, function(res) {
            expect(res.status).to.be(200);
            expect(user.isAdminOf(event)).to.be(true)
            done()
        });
    });
    it("removes event admins by known email", function(done) {
        var event = common.server.db.events.at(0);
        var email = event.get("admins")[0].email;
        var user = common.server.db.users.findByEmail(email);

        expect(user.isAdminOf(event)).to.be(true);
        postUsers("superuser1", {
            action: "remove-admin",
            email: email,
            eventId: event.id
        }, function(res) {
            expect(res.status).to.be(200);
            expect(user.isAdminOf(event)).to.be(false);
            expect(event.get("admins")).to.eql([]);
            done()
        });
    });
    it("adds event admins by unknown email", function(done) {
        var user = common.server.db.users.findByEmail("nonexistent@example.com");
        expect(user).to.be(undefined);
        var event = common.server.db.events.at(0);
        event.set("admins", []);
        postUsers("superuser1", {
            action: "add-admin",
            email: "nonexistent@example.com",
            eventId: event.id
        }, function(res) {
            expect(res.status).to.be(200);
            var user = new models.ServerUser({emails: [{value: "nonexistent@example.com"}]});
            expect(user.isAdminOf(event)).to.be(true)
            done()
        });
    });
    it("removes event admins by unknown email", function(done) {
        var event = common.server.db.events.at(0);
        event.set("admins", [{email: "nonexistent@example.com"}]);
        expect(new models.ServerUser({emails: [{value: "nonexistent@example.com"}]}).isAdminOf(event)).to.be(true);

        postUsers("superuser1", {
            action: "remove-admin",
            email: "nonexistent@example.com",
            eventId: event.id
        }, function(res) {
            expect(res.status).to.be(200);
            expect(event.get("admins")).to.eql([]);
            expect(new models.ServerUser({emails: [{value: "nonexistent@example.com"}]}).isAdminOf(event)).to.be(false);
            done();
        });
    });
    it("removes event admins by email when they were added by id", function(done) {
        var event = common.server.db.events.at(0);
        var user = common.server.db.users.findWhere({superuser: false});
        event.set("admins", [{id: user.id}]);
        expect(user.isAdminOf(event)).to.be(true);
        // Make sure it has an email set...
        expect(!!user.get('emails')[0].value).to.be(true);
        
        postUsers("superuser1", {
            action: "remove-admin",
            email: user.get('emails')[0].value,
            eventId: event.id
        }, function(res) {
            expect(res.status).to.be(200);
            expect(user.isAdminOf(event)).to.be(false);
            expect(event.get("admins")).to.eql([]);
            done();
        });
    });
    it("removes event admins by id when they were added by email", function(done) {
        var event = common.server.db.events.at(0);
        var user = common.server.db.users.findWhere({superuser: false});
        event.set("admins", [{email: user.get('emails')[0].value}]);
        expect(user.isAdminOf(event)).to.be(true);
        postUsers("superuser1", {
            action: "remove-admin",
            userId: user.id,
            eventId: event.id
        }, function(res) {
            expect(res.status).to.be(200);
            expect(user.isAdminOf(event)).to.be(false);
            expect(event.get("admins")).to.eql([]);
            done();
        });
    });
});

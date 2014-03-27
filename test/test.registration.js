var common = require("./common.js"),
    models = require("../lib/server-models.js"),
    conf = require('../lib/options'),
    sync = require("../lib/redis-sync"),
    expect = require('expect.js'),
    _ = require('underscore');

// This module tests the basic registration functions that are called by our
// authentication wrapper (passport).  It does *not* test the actual
// function of passport, or our implementation of passport, because that
// requires phoning home to Google -- but as long as passport is wired up
// correctly, this should verify that the logic of handling logins on our
// end works.

function buildProfile(attrs) {
    // This should match a profile as given by Google+:
    // https://developers.google.com/+/api/latest/people
    return _.extend({
        _raw: {'all sorts': 'of stuff', 'we don': 't care about'},
        id: parseInt(Math.random() * 1000000000000),
        emails: [{value: 'one@example.com'}, {value: 'two@example.com'}],
        picture: "",
        displayName: "Jane Doe"
    }, attrs);
}

describe("REGISTRATION", function() {
    beforeEach(function() {
        sync.setPersist(false);
    });

    it("adds new users on register", function(done) {
        // Create a new user list to run tests with.
        var users = new models.ServerUserList();
        // Create a new profile.
        var profile = buildProfile();
        // See that we get registered as expected.
        users.registerOrUpdate("accesstoken", "refreshtoken", profile,
            function(err, userJSON) {
                var expected = _.extend({}, profile);
                delete expected['_raw'];
                // Have to do this with loop because expect only looks a couple
                // of levels deep into objects for comparison.
                for (var key in expected) {
                    expect(userJSON[key]).to.eql(expected[key]);
                }
                expect(users.length).to.be(1)
                expect(users.at(0).isSuperuser()).to.be(false);
                done();
            }
        );
    });
    it("updates existing users on register", function(done) {
        var users = new models.ServerUserList();

        // Get an original user's properties
        var orig = buildProfile();
        // Copy those properties for an update
        var update = _.extend({}, orig, {displayName: "John Doe"});

        // Ensure that we're actually changing stuff.
        expect(orig.displayName).to.not.eql(update.displayName);

        // Add the original user.. ordinarily this would be done with
        // registerOrUpdate; bootstrapping it here.
        delete orig._raw
        var user = new models.ServerUser(orig);
        user.set("superuser", true);
        users.add(user);

        // Call registerOrUpdate to update the user, and ensure that it has
        // been updated.
        users.registerOrUpdate("accesstoken", "refreshtoken", update,
            function(err, userJSON) {
                expect(userJSON.displayName).to.be(update.displayName);
                expect(userJSON.superuser).to.be(true);
                expect(users.length).to.be(1);
                expect(users.at(0).id).to.be(orig.id);
                done();
            }
        );
    });
    it("assigns superusers from conf", function(done) {
        // Verify that users whose emails are listed in
        // conf.UNHANGOUT_SUPERUSER_EMAILS are assigned superuser status on
        // register.
        var users = new models.ServerUserList();
        var profile = buildProfile();
        // Not a superuser yet
        expect(profile.superuser).to.be(undefined)

        // Register, and be superuserified.
        conf.UNHANGOUT_SUPERUSER_EMAILS = [profile.emails[0].value];
        users.registerOrUpdate("accesstoken", "refreshtoken", profile,
            function(err, userJSON) {
                expect(users.length).to.be(1);
                expect(users.at(0).id).to.be(profile.id);
                expect(users.at(0).isSuperuser()).to.be(true);
                expect(userJSON.superuser).to.be(true);
                done();
            }
        );
    });
});


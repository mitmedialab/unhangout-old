var models = require('../lib/server-models.js'),
    client_models = require('../public/js/models.js'),
    should = require('should'),
    sync = require("../lib/redis-sync.js");

describe("SERVEREVENT", function() {
    beforeEach(function() {
        sync.setPersist(false);
    });

    describe("#new", function() {
        it('should construct a default model', function() {
            var event = new models.ServerEvent();
            should.exist(event);
        });
    });
});

// describe("SESSION", function() {

// });

describe("USER", function() {
    describe("#getShortDisplayName", function () {
        it('should work on simple first/last names', function() {
            var user = new client_models.User({displayName:"Drew Harry"});

            user.getShortDisplayName().should.equal("Drew H");
        });

        it("should work on hyphenated last names", function() {
            var user = new client_models.User({displayName:"Drew Harry-Chang"});

            user.getShortDisplayName().should.equal("Drew H-C");
        });

        it("should work with hyphenated middle names", function() {
            var user = new client_models.User({displayName:"Drew Erikson-Chikako Harry"});

            user.getShortDisplayName().should.equal("Drew E-C H");
        });
    });
});

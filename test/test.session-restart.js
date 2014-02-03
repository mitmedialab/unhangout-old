var server = require('../lib/unhangout-server'),
    models = require("../lib/server-models"),
	expect = require('expect.js'),
	_ = require('underscore'),
    sinon = require('sinon'),
    Backbone = require("backbone"),
    common = require('./common');

Backbone.sync = require("../lib/redis-sync").dummySync;


var participants = [{id: 1, displayName: "Fun"}, {id: 2, displayName: "Times"}];

describe('RESTARTING SESSIONS', function() {
    it("Removes connected participants on restart", function() {
        var session = new models.ServerSession({connectedParticipants: participants});
        session.onRestart();
        expect(session.getNumConnectedParticipants()).to.be(0);
    });

    it("Removes hangout-url after a timeout after restart", function() {
        var session = new models.ServerSession({
            connectedParticipants: participants,
            "hangout-url": "http://example.com"
        });

        var clock = sinon.useFakeTimers();
        session.onRestart()
        clock.tick(session.RESTART_HANGOUT_URL_EXPIRATION_TIMEOUT + 1);
        expect(session.get("hangout-url")).to.be(null);
        clock.restore();
    });

    it("Does not remove hangout-url if participants join before timeout", function() {
        var session = new models.ServerSession({
            connectedParticipants: participants,
            "hangout-url": "http://example.com"
        });

        var clock = sinon.useFakeTimers();
        session.onRestart();
        clock.tick(session.RESTART_HANGOUT_URL_EXPIRATION_TIMEOUT - 1);
        session.setConnectedParticipants(participants);
        clock.tick(session.RESTART_HANGOUT_URL_EXPIRATION_TIMEOUT);
        expect(session.get("hangout-url")).to.be("http://example.com");
    });

});

var server = require('../lib/unhangout-server'),
    models = require("../lib/server-models"),
    expect = require('expect.js'),
    _ = require('underscore'),
    sinon = require('sinon'),
    sync = require("../lib/redis-sync"),
    common = require('./common');



var participants = [{id: 1, displayName: "Fun", picture: ""},
                    {id: 2, displayName: "Times", picture: ""}];

describe('SESSION LIFECYCLE', function() {
    beforeEach(function() {
        sync.setPersist(false);
    });

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
        clock.restore();
    });

    it("Calculates total seconds active", function() {
        var session = new models.ServerSession();

        var clock = sinon.useFakeTimers();

        session.onHangoutStarted();
        clock.tick(10000);
        session.onHangoutStopped();

        expect(session.get("total-seconds")).to.be(10);
        expect(session.get("hangout-start-time")).to.be(null);

        session.onHangoutStarted();
        clock.tick(10000);
        session.onHangoutStopped();

        expect(session.get("total-seconds")).to.be(20);
        expect(session.get("hangout-start-time")).to.be(null);

        expect(session.get("total-instances")).to.be(2);

        clock.restore();
    });

    it("Continues counting session elapsed after restart", function() {
        var clock = sinon.useFakeTimers();
        var start = new Date().getTime();
        clock.tick(10000);
        var session = new models.ServerSession({
            "total-instances": 1,
            "hangout-start-time": start
        });
        clock.tick(10000);
        session.onHangoutStopped();

        expect(session.get("total-seconds")).to.be(20);
        // No new instance for a re-start.
        expect(session.get("total-instances")).to.be(1);
        clock.restore();
    });

    it("Stops with delay, event with stale connected participants", function() {
        var clock = sinon.useFakeTimers();
        var session = new models.ServerSession({
            // Set isPermalinkSession so we don't look like a deleted event
            // session without a collection
            "isPermalinkSession": true,
            "hangout-url": "http://example.com",
            "hangout-start-time": new Date().getTime(),
            "connectedParticipants": [{"id": "stuff", "displayName": "Socketless"}]
        });
        session.stopWithDelay();
        expect(session.get("hangout-stop-request-time")).to.be(new Date().getTime());
        clock.tick(session.HANGOUT_LEAVE_STOP_TIMEOUT/ 2);
        expect(session.get("hangout-url")).to.be("http://example.com")
        clock.tick(session.HANGOUT_LEAVE_STOP_TIMEOUT/ 2 + 1);
        expect(session.get("hangout-url")).to.be(null);
        expect(session.get("hangout-start-time")).to.be(null);
        expect(session.get("hangout-stop-request-time")).to.be(null);
        clock.restore();
    });
    it("Interrupts stops with delay if new participants join", function() {
        var clock = sinon.useFakeTimers();
        var session = new models.ServerSession({
            // Set isPermalinkSession so we don't look like a deleted event
            // session without a collection
            "isPermalinkSession": true,
            "hangout-url": "http://example.com",
            "hangout-start-time": new Date().getTime(),
            "connectedParticipants": [{"id": "stuff", "displayName": "Socketless"}]
        });
        session.stopWithDelay();
        expect(session.get("hangout-stop-request-time")).to.be(new Date().getTime());
        clock.tick(session.HANGOUT_LEAVE_STOP_TIMEOUT/ 2);

        session.setConnectedParticipants([
            {"id": "stuff", "displayName": "Socketless"},
            {"id": "stuff2", "displayName": "Socketful"},
        ]);

        clock.tick(session.HANGOUT_LEAVE_STOP_TIMEOUT/ 2 + 1);
        expect(session.get("hangout-url")).to.be("http://example.com");
        expect(session.get("hangout-start-time")).to.not.be(null);
        expect(session.get("hangout-stop-request-time")).to.be(null);
        clock.restore();
    });


    it("Continues stopping timeout after restart", function() {
        var clock  = sinon.useFakeTimers();
        var reqtime =  new Date().getTime() - models.ServerSession.prototype.HANGOUT_LEAVE_STOP_TIMEOUT / 2;
        var session = new models.ServerSession({
            "hangout-url": "http://example.com",
            "hangout-start-time": reqtime - 1000,
            "hangout-stop-request-time": reqtime
        }, {
            collection: new models.ServerSessionList()
        });
        session.onRestart();
        expect(session.getState()).to.be("stopping");
        clock.tick(models.ServerSession.prototype.HANGOUT_LEAVE_STOP_TIMEOUT / 2 + 1);
        expect(session.getState()).to.be("stopped");
        clock.restore();
    });

    it("Continues pending timeout after restart", function() {
        var clock  = sinon.useFakeTimers();
        var time = new Date().getTime() - models.ServerSession.prototype.HANGOUT_CREATION_TIMEOUT / 2;
        var session = new models.ServerSession({
            "hangout-url": null,
            "hangout-start-time": null,
            "hangout-pending": {time: time}
        }, {
            collection: new models.ServerSessionList()
        });
        session.onRestart();
        expect(session.getState()).to.be("pending");
        clock.tick(models.ServerSession.prototype.HANGOUT_CREATION_TIMEOUT / 2 + 1);
        expect(session.getState()).to.be("stopped");
        clock.restore();
    });

    it("Interprets state as expected", function() {
        function expectState(state, params) {
            var session = new models.ServerSession(params);
            expect(session.getState()).to.eql(state);
        }
        expectState("started", {
            connectedParticipants: [{id: 1, displayName: "foo"}],
            "hangout-start-time": 10,
            "hangout-url": "http://example.com"
        });
        expectState("stopped", {
            connectedParticipants: [],
            "hangout-start-time": null,
            "hangout-url": null
        });
        expectState("unstopped", {
            connectedParticipants: [],
            "hangout-start-time": 10,
            "hangout-url": null
        });
        expectState("stale url", {
            connectedParticipants: [],
            "hangout-start-time": null,
            "hangout-url": "http://example.com"
        });
        expectState("stale url; unstopped", {
            connectedParticipants: [],
            "hangout-start-time": 10,
            "hangout-url": "http://example.com"
        });
        expectState("pending overdue; uncleared pending", {
            connectedParticipants: [],
            "hangout-start-time": null,
            "hangout-url": null,
            "hangout-pending": {
                time: new Date().getTime() - models.ServerSession.prototype.HANGOUT_CREATION_TIMEOUT -1
            }
        });
        expectState("stopping", {
            connectedParticipants: [],
            "hangout-start-time": new Date().getTime() - 1000,
            "hangout-url": "http://example.com",
            "hangout-stop-request-time": new Date().getTime() - 500
        });
        expectState("stopping overdue; uncleared stopping", {
            connectedParticipants: [],
            "hangout-start-time": null,
            "hangout-url": null,
            "hangout-stop-request-time": new Date().getTime() - models.ServerSession.prototype.HANGOUT_LEAVE_STOP_TIMEOUT - 1
        });
        expectState("stopping overdue; uncleared stopping; stale url; unstopped", {
            connectedParticipants: [],
            "hangout-start-time": new Date().getTime() - 100000,
            "hangout-url": "http://example.com",
            "hangout-stop-request-time": new Date().getTime() - models.ServerSession.prototype.HANGOUT_LEAVE_STOP_TIMEOUT - 1
        });
    });

    it("Adds and expires joining participants", function() {
        var event = new models.ServerEvent({id: 1});
        var session = new models.ServerSession({id: 1});
        event.get("sessions").add(session);
        var u1 = new models.ServerUser(participants[0]);
        var u2 = new models.ServerUser(participants[1]);

        // Collect a list of broadcasts from the event to make sure they match
        // expectation.
        var broadcasts = [];
        event.on("broadcast", function(event, type, data) {
            broadcasts.push({type: type, data: data});
        });

        var clock = sinon.useFakeTimers();

        // Add a joining participant...
        session.addJoiningParticipant(u1);
        expect(session.get("joiningParticipants")).to.eql([participants[0]])
        expect(session.joiningTimeouts[u1.id]).to.not.eql(undefined);
        expect(broadcasts.pop()).to.eql({
            type: "joining-participants",
            data: {id: session.id, participants: [participants[0]]}
        });

        // Tick forward till expiration
        clock.tick(models.ServerSession.prototype.JOINING_EXPIRATION_TIMEOUT + 1);

        expect(session.joiningTimeouts[u1.id]).to.be(undefined);
        expect(session.get("joiningParticipants")).to.eql([]);

        expect(broadcasts.pop()).to.eql({
            type: "joining-participants",
            data: {id: session.id, participants: []}
        });
        expect(broadcasts).to.eql([]);
        clock.restore();
    });

    it("Removes joining participants on connection", function() {
        var event = new models.ServerEvent({id: 1});
        var session = new models.ServerSession({id: 1});
        event.get("sessions").add(session);
        var p0 = participants[0];
        var p1 = participants[1];
        var u1 = new models.ServerUser(p0);
        var u2 = new models.ServerUser(p1);

        // Collect a list of broadcasts from the event to make sure they match
        // expectation.
        var broadcasts = [];
        event.on("broadcast", function(event, type, data) {
            var copy = _.clone(data);
            for (var key in copy) {
                copy[key] = _.clone(copy[key]);
            }
            broadcasts.push({type: type, data: copy});
        });

        var clock = sinon.useFakeTimers();

        session.addJoiningParticipant(u1);
        session.addJoiningParticipant(u2);
        expect(_.size(session.joiningTimeouts)).to.be(2);

        // Advance by half the expiration time
        clock.tick(models.ServerSession.prototype.JOINING_EXPIRATION_TIMEOUT/2)

        session.addConnectedParticipant(u1);
        expect(session.get("connectedParticipants")).to.eql([p0]);
        expect(broadcasts).to.eql([
            {type: "joining-participants", data: {id: session.id, participants: [p0]}},
            {type: "joining-participants", data: {id: session.id, participants: [p0, p1]}},
            {type: "joining-participants", data: {id: session.id, participants: [p1]}},
            {type: "session-participants", data: {id: session.id, participants: [p0]}},
        ]);
        expect(_.size(session.joiningTimeouts)).to.be(1);
        expect(session.joiningTimeouts[u2.id]).to.not.eql(undefined);

        clock.tick(models.ServerSession.prototype.JOINING_EXPIRATION_TIMEOUT/2 + 1)

        expect(_.size(session.joiningTimeouts)).to.be(0);
        expect(session.get("joiningParticipants")).to.eql([]);
        expect(broadcasts[broadcasts.length - 1]).to.eql({
            type: "joining-participants", data: {id: session.id, participants: []}
        });
        clock.restore();
    });

    it("Expires joining participants on restart after timeout", function() {
        var session = new models.ServerSession({id: 1, joiningParticipants: participants});
        expect(_.size(session.joiningTimeouts)).to.be(0);

        var clock = sinon.useFakeTimers();
        session.onRestart();
        expect(_.size(session.joiningTimeouts)).to.be(2);
        clock.tick(models.ServerSession.prototype.JOINING_EXPIRATION_TIMEOUT + 1);
        expect(_.size(session.joiningTimeouts)).to.be(0);
        clock.restore();
    });

    it("Expires HoA sessions too", function() {
        var session = new models.ServerHoASession({
            id: 1,
            connectedParticipants: participants,
            "hangout-url": "http://example.com"
        });
        var clock = sinon.useFakeTimers(new Date().getTime());
        session.setConnectedParticipants([]);
        session.stopWithDelay();
        expect(session.get("hangout-stop-request-time")).to.be.a('number');
        clock.tick(session.HANGOUT_LEAVE_STOP_TIMEOUT + 1);
        expect(session.get("hangout-url")).to.be(null);
        expect(session.get("hangout-stop-request-time")).to.be(null);
        clock.restore();
    });
});

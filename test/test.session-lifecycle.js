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
        event.on("all", function() {
            broadcasts.push(Array.prototype.slice.call(arguments, 0))
        });

        var clock = sinon.useFakeTimers();

        // Add a joining participant...
        session.addJoiningParticipant(u1);
        expect(session.get("joiningParticipants")).to.eql([participants[0]])
        expect(session.joiningTimeouts[u1.id]).to.not.eql(undefined);
        expect(broadcasts).to.eql([
            ["sessions:change:joiningParticipants", event, session, [participants[0]], {}],
            ["sessions:change", event, session, {}]
        ]);
        broadcasts = [];

        // Tick forward till expiration
        clock.tick(models.ServerSession.prototype.JOINING_EXPIRATION_TIMEOUT + 1);

        expect(session.joiningTimeouts[u1.id]).to.be(undefined);
        expect(session.get("joiningParticipants")).to.eql([]);

        expect(broadcasts).to.eql([
            ["sessions:change:joiningParticipants", event, session, [], {}],
            ["sessions:change", event, session, {}]
        ]);
        clock.restore();
    });

    it("Removes joining participants on connection", function() {
        var event = new models.ServerEvent({id: 1});
        var session = new models.ServerSession({id: 1});
        event.get("sessions").add(session);
        var p0 = participants[0];
        var p1 = participants[1];
        var u0 = new models.ServerUser(p0);
        var u1 = new models.ServerUser(p1);

        // Collect a list of broadcasts from the event to make sure they match
        // expectation.
        var broadcasts = [];
        event.on("all", function() {
            var copy = Array.prototype.slice.call(arguments);
            // clone parameter args, so we can keep a history without them
            // being mutated.
            if (copy[3]) {
                copy[3] = _.clone(copy[3]);
            }
            broadcasts.push(copy);
        });

        var clock = sinon.useFakeTimers();

        session.addJoiningParticipant(u0);
        session.addJoiningParticipant(u1);
        expect(_.size(session.joiningTimeouts)).to.be(2);

        // Advance by half the expiration time
        clock.tick(models.ServerSession.prototype.JOINING_EXPIRATION_TIMEOUT/2)

        session.addConnectedParticipant(u0);
        expect(session.get("connectedParticipants")).to.eql([p0]);
        var expectedBroadcasts = [
            ["sessions:change:joiningParticipants", event, session, [p0], {}],
            ["sessions:change", event, session, {}],
            ["sessions:change:joiningParticipants", event, session, [p0, p1], {}],
            ["sessions:change", event, session, {}],
            ["sessions:change:connectedParticipants", event, session, [p0], {}],
            ["sessions:change", event, session, {}],
            ["sessions:change:joiningParticipants", event, session, [p1], {}],
            ["sessions:change", event, session, {}],
        ];
        // Split this nasty thing up so it's a little easier to parse.
        expect(broadcasts.length).to.eql(expectedBroadcasts.length);
        for (var i = 0; i < broadcasts.length; i++) {
            for (var j = 0; j < broadcasts[i].length; j++) {
                // console.log(i, j, broadcasts[i][0]);
                expect(broadcasts[i][j]).to.eql(expectedBroadcasts[i][j]);
                expect(broadcasts[i].length).to.eql(expectedBroadcasts[i].length);
            }
        }
        broadcasts = [];

        expect(_.size(session.joiningTimeouts)).to.be(1);
        expect(session.joiningTimeouts[u1.id]).to.not.eql(undefined);

        clock.tick(models.ServerSession.prototype.JOINING_EXPIRATION_TIMEOUT/2 + 1)
        clock.restore();


        expect(_.size(session.joiningTimeouts)).to.be(0);
        expect(session.get("joiningParticipants")).to.eql([]);
        expect(broadcasts).to.eql([
            ["sessions:change:joiningParticipants", event, session, [], {}],
            ["sessions:change", event, session, {}]
        ]);
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

    it("Doesn't crash on removal of joining participant when session has been deleted.", function(done) {
        // https://github.com/drewww/unhangout/issues/311
        common.standardSetup(function() {
            var event = common.server.db.events.get(1);
            var session = event.get("sessions").at(0);
            session.addJoiningParticipant(common.server.db.users.get(1));

            var clock = sinon.useFakeTimers(new Date().getTime());
            session.onRestart();
            session.destroy();
            event.get("sessions").remove(session);
            clock.tick(session.JOINING_EXPIRATION_TIMEOUT + 1);
            clock.restore();

            common.standardShutdown(done);
        });
    });
});

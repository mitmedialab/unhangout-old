var server = require("../lib/unhangout-server"),
    expect = require("expect.js"),
    _ = require("underscore"),
    sinon = require("sinon"),
    models = require("../lib/server-models"),
    common = require("./common");

describe("EVENT HISTORY", function() {
    beforeEach(common.standardSetup);
    afterEach(common.standardShutdown);

    it("Starts with empty history", function() {
        var event = new models.ServerEvent();
        expect(event.get("history")).to.eql({event: {}, sessions: {}});
    });

    it("Starts/stops history when users join/leave", function() {
        var clock = sinon.useFakeTimers(0, "setTimeout", "clearTimeout", "Date");
        var event = new models.ServerEvent({open: true});
        var user = common.server.db.users.get(1);

        event.get("connectedUsers").add(user);
        expect(event.get("history")).to.eql({
            event: {"1": {total: 0, start: 0}},
            sessions: {}
        });
        clock.tick(1000);
        event.get("connectedUsers").pop();
        expect(event.get("history")).to.eql({
            event: {"1": {total: 1000, start: null}},
            sessions: {}
        });
        clock.restore();
    });

    it("Starts/stops history only when event is open", function() {
        var clock = sinon.useFakeTimers(0, "setTimeout", "clearTimeout", "Date");
        var event = new models.ServerEvent({open: false});
        var session = new models.ServerSession();
        session.save(); // make sure it gets an ID.
        var user = common.server.db.users.get(1);

        event.get("connectedUsers").add(user);
        event.get("sessions").add(session);
        session.addConnectedParticipant(user);

        expect(event.get("history")).to.eql({event: {}, sessions: {}});

        // On open, history is started.
        event.set("open", true);
        var hist = {event: {"1": {total: 0, start: 0}}, sessions: {}}
        hist.sessions[session.id] = {"1": {total: 0, start: 0}}
        expect(event.get("history")).to.eql(hist);

        clock.tick(1002);
        event.set("open", false);
        hist.event["1"] = {total: 1002, start: null};
        hist.sessions[session.id]["1"] = hist.event["1"];
        expect(event.get("history")).to.eql(hist);

        clock.restore();
        // On close, history stops again.
    });

    it("Starts session history on join, if they have an ID.", function() {
        var clock = sinon.useFakeTimers(0, "setTimeout", "clearTimeout", "Date");
        var event = new models.ServerEvent({open: true});
        var session = new models.ServerSession();
        session.save(); // make sure it gets an ID.
        var user = common.server.db.users.get(1);
        event.get("sessions").add(session);
        session.addConnectedParticipant(user);

        var hist = {event: {}, sessions: {}};
        hist.sessions[session.id] = {"1": {start: 0, total: 0}};
        expect(event.get("history")).to.eql(hist);
        clock.restore();
    });


    it("Stops all on init.", function() {
        var clock = sinon.useFakeTimers(1, "setTimeout", "clearTimeout", "Date");
        var event = new models.ServerEvent({
            open: true,
            history: {
                event: {"1": {total: 1234, start: Date.now() - 1}},
                sessions: {"1": {"1": {total: 2345, start: Date.now() - 1}}}
            }
        });
        expect(event.get("history")).to.eql({
            event: {"1": {total: 1235, start: null}},
            sessions: {"1": {"1": {total: 2346, start: null}}}
        });
        clock.restore();
    });

});

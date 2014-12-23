var server = require("../lib/unhangout-server"),
    expect = require("expect.js"),
    _ = require("underscore"),
    sinon = require("sinon"),
    models = require("../lib/server-models"),
    common = require("./common");

describe("EVENT HISTORY", function() {
    beforeEach(common.standardSetup);
    afterEach(common.standardShutdown);
    after(common.restoreTimers);

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
        
        // On close, history stops again.
        event.set("open", false);
        hist.event["1"] = {total: 1002, start: null};
        hist.sessions[session.id]["1"] = hist.event["1"];
        expect(event.get("history")).to.eql(hist);

        clock.restore();
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

    it("Inits history correctly", function() {
      var event = new models.ServerEvent({
        history: {
          sessions: {
            "oneMember": {
              "1": {total: 1000, start: null},
            },
            "twoMembers": {
              "1": {total: 1000, start: null},
              "2": {total: 1000, start: null}
            },
            "threeMembers": {
              "2": {total: 1000, start: null},
              "3": {total: 2000, start: null},
              "4": {total: 2000, start: null},
            },
            "lonesome": {
              "5": {total: 1234, start: null}
            }
          }
        }
      });
      var history = event.get("history");
      expect(history.sessions.oneMember["1"].total).to.be(1000);
      expect(history.sessions.twoMembers["1"].total).to.be(1000);
      expect(history.sessions.twoMembers["2"].total).to.be(1000);
      expect(history.sessions.threeMembers["2"].total).to.be(1000);
      expect(history.sessions.threeMembers["3"].total).to.be(2000);
      expect(history.sessions.threeMembers["4"].total).to.be(2000);
      expect(history.sessions.lonesome["5"].total).to.be(1234);
    });

    it("gets userids sharing sessions with given userid", function() {
      var event = new models.ServerEvent({
        history: {
          sessions: {
            "oneMember": {
              "1": {total: 1000, start: null},
            },
            "twoMembers": {
              "1": {total: 1000, start: null},
              "2": {total: 1000, start: null}
            },
            "threeMembers": {
              "2": {total: 1000, start: null},
              "3": {total: 2000, start: null},
              "4": {total: 2000, start: null},
            },
            "lonesome": {
              "5": {total: 1234, start: null}
            }
          }
        }
    });

    expect(event.getUserIdsSharingSessionsWith("1")).to.eql(["2"]);
    expect(event.getUserIdsSharingSessionsWith("2")).to.eql(["1", "3", "4"]);
    expect(event.getUserIdsSharingSessionsWith("3")).to.eql(["2", "4"]);
    expect(event.getUserIdsSharingSessionsWith("4")).to.eql(["2", "3"]);
    expect(event.getUserIdsSharingSessionsWith("5")).to.eql([]);
    expect(event.getUserIdsSharingSessionsWith("4", 1000)).to.eql(["3"]);
  });

});

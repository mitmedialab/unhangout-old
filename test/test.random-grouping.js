var server = require("../lib/unhangout-server");
var expect = require("chai").expect;
var _ = require("underscore");
var models = require("../lib/server-models");
var options = require("../lib/options");
var randomGrouping = require("../lib/random-grouping");
var request = require('superagent');
var common = require("./common");
var Promise = require("bluebird");

describe("RANDOM GROUPING", function() {
  var event, eventId, group;

  beforeEach(function(done) {
    common.standardSetup(function() {
      event = common.server.db.events.get(1);
      event.set("randomizedSessions", true);
      eventId = event.get("id");
      group = randomGrouping(common.server.db, options);
      done();
    });
  });

  afterEach(common.standardShutdown);

  describe("library", function() {
    it("Creates randomized session", function() {
      var length = event.get("sessions").length;
      var sess1, sess2;

      expect(length).to.be.above(0);
      expect(event.getRandomizedSessions()).to.deep.equal([]);

      return group._createRandomizedSession(event)
      .then(function(session) {
        sess1 = session;
        expect(event.get("sessions").length).to.equal(length + 1);
        expect(event.get("sessions").at(length)).to.equal(session);

        expect(session.get('title')).to.equal("Breakout Room 1");
        expect(session.get('proposedBy')).to.be.null;
        expect(session.get('activities')).to.deep.equal([{type: "about", autoHide: true}]);
        expect(session.get('joinCap')).to.equal(6);
        expect(session.get('randomized')).to.equal(true);
        expect(session.get('approved')).to.equal(true);

        return group._createRandomizedSession(event);
      })
      .then(function(session) {
        sess2 = session;
        expect(event.get("sessions").length).to.equal(length + 2);
        expect(session.get("title")).to.equal("Breakout Room 2");
        expect(session.get('randomized')).to.be.true;
      })
      .then(function() {
        expect(event.getRandomizedSessions()).to.deep.equal([sess1, sess2]);
      });
    });

    it("Assigns a user to a session", function() {
      var user = common.server.db.users.at(0);
      return group.assignRandomizedSession(event.id, user.id)
      .then(function(sessionId) {
        var session = event.get("sessions").get(sessionId);
        expect(session).to.not.be.null;
        expect(session.get("assignedParticipants")).to.deep.equal([user.id]);
        var assign = {};
        assign[event.id] = session.id;
        // Reassignment
        return group.assignRandomizedSession(event.id, user.id).then(function(sessionId2) {
          expect(sessionId2).to.not.equal(sessionId);
          var session2 = event.get("sessions").get(sessionId2);
          expect(session.get("assignedParticipants")).to.deep.equal([]);
          expect(session2.get("assignedParticipants")).to.deep.equal([user.id]);
          assign[event.id] = session2.id;
        });
      });
    });

    it("Mass asignment: multiple sessions", function() {
      var p = Promise.resolve();
      _.range(13).map(function(i) {
        p = p.then(function() {
          var user = new models.ServerUser(
            {displayName: "Rando " + i},
            {collection: common.server.db.users}
          );
          return new Promise(function(resolve, reject) {
            user.save({}, {
              success: function(user) {
                user.collection.add(user);
                resolve(user);
              },
              error: reject,
            });
          }).then(function(user) {
            return group.assignRandomizedSession(event.id, user.id);
          });
        });
      })
      return p
      .then(function() {
        var randos = event.getRandomizedSessions();
        expect(randos.length).to.equal(3);
        expect(randos[0].get("assignedParticipants").length).to.equal(6);
        expect(randos[1].get("assignedParticipants").length).to.equal(6);
        expect(randos[2].get("assignedParticipants").length).to.equal(1);
      });
    });
  });

//  describe("Sockets", function() {
//    it("Assigns randomized session on socket message", function() {
//      var sock = comm
//    });
//  });
});

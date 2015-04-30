var server = require('../lib/unhangout-server'),
    expect = require('expect.js'),
    _ = require('underscore')._,
    Promise = require("bluebird"),
    request = require('superagent'),
    options = require("../lib/options"),
    followupBooter = require("../lib/followup-emails"),
    common = require('./common');

describe("POST EVENT FOLLOWUP EMAIL", function() {
  var event, session, session2;
  var users = {};
  var followup;

  beforeEach(function(done) {
    common.standardSetup(function() {
      event = common.server.db.events.get(1);
      followup = followupBooter(common.server.db, options);
      common.prepareFollowupEventAndUsers(event, users);
      done();
    });
  });
  afterEach(common.standardShutdown);


  function checkRender() {
    return followup.renderAllEmails(common.server.app, event).then(function(htmlAndUsers) {
      expect(htmlAndUsers.length).to.eql(_.size(users));
    });
  }


  it("Renders HTML for emails", function(done) {
    checkRender().then(function() {
      users.emailOnly.set("preferredContact", null);
      return checkRender();
    }).then(function() {
      users.emailOnly.set("preferredContact", {email: null, noShare: false});
      return checkRender();
    }).then(function() {
      done();
    }).catch(function(err) {
      done(err);
    });
  });
});

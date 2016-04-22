#!/usr/bin/env node
// Dump all pertinent redis data to json.

process.env.NODE_ENV = "testing"; // suppress logging that harshes our stdout.

var Promise = require("bluebird");
var UnhangoutDb = require("../lib/unhangout-db");
var options = require("../lib/options");

function main() {
  var db = new UnhangoutDb(options);
  return new Promise(function(resolve, reject) {
    return db.init(function(err) { err ? reject(err) : resolve() });
  }).then(function() {
    var data = {
      'events': {},
      'sessions': {},
      'permalinkSessions': {},
      'users': {},
    };
    db.events.each(function(event, i) {
      data['events'][event.id] = event.toJSON();
      event.get("sessions").each(function(session, i) {
        data['sessions'][session.id] = session.toJSON();
      });
    });
    db.permalinkSessions.each(function(session, i) {
      data['permalinkSessions'][session.id] = session.toJSON();
    });
    db.users.each(function(user, i) {
      data['users'][user.id] = user.toJSON();
    });

    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
  }).catch(function(e) {
    console.error(e.stack);
    process.exit(1);
  });
}

if (require.main === module) {
  main();
}
// vi: ft=javascript

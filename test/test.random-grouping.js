var server = require("../lib/unhangout-server"),
    expect = require("expect.js"),
    _ = require("underscore"),
    models = require("../lib/server-models"),
    options = require("../lib/options"),
    groupBooter = require("../lib/random-grouping"),
    request = require('superagent');
    common = require("./common");

describe("GROUP USER", function() {
	var event, eventId, group;

    beforeEach(function(done) {
	    common.standardSetup(function() {
	      event = common.server.db.events.get(1);
	      event.set("randomizedSessions", true);
	      eventId = event.get("id");
	      group = groupBooter(common.server.db, options);
	      done();
	    });
  	});

    afterEach(common.standardShutdown);
    after(common.restoreTimers);

    it("GROUP ASSIGNED", function(done) {
    	var user = common.server.db.users.findWhere({"sock-key": "regular1"});
    	user.setSessionPreference(eventId, null);
    	var userId = user.get("id");

    	request.get(common.URL + "/event/" + eventId)
            .set("x-mock-user", "regular1")
            .redirects(0)
            .end(function(res) {
            	group.assignGroupToUser(userId, eventId).then(function() {
            		//TODO
            	}); 
                expect(res.status).to.be(200);
                done();
            });
    });
});
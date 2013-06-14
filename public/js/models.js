// This is include-able both in a browser environment and in a v8/node env,
// so it needs to figure out which situation it is in. If it's on the server,
// put everything in exports and behave like a module. If it's on the client,
// fake it and expect the client to understand how to deal with things.
var _ = require('underscore')._,
	crypto = require('crypto'),
    Backbone = require('backbone');
    
exports.Event = Backbone.Model.extend({
	idRoot: "event",
	
	urlRoot: "event",
	
	defaults: function() {
		// also need:
		// 	1. Some sort of image.
		return {
			title: "My Great Event",
			organizer: "MIT Media Lab",
			description: "This is my description about this great event. It has wonderful sessions in it.",
			start: new Date().getTime(),
			end: new Date().getTime()+60*60*2*1000,
			connectedUsers: null,			// these two fields are setup in initialize
			sessions: null
		}
	},
	
	initialize: function() {
		this.set("sessions", new exports.SessionList(null, this));
		this.set("connectedUsers", new exports.UserList());
	},
	
	isLive: function() {
		var curTime = new Date().getTime();
		return curTime > this.get("start") && curTime < this.get("end");
	},
	
	userConnected: function(user) {
		this.get("connectedUsers").add(user);
	},
	
	numUsersConnected: function() {
		return this.get("connectedUsers").length;
	},
	
	toJSON: function() {
		var attrs = _.clone(this.attributes);
		delete attrs["connectedUsers"];
		
		// for now just delete sessions; they'll save separately and will know their
		// event by id + url.
		delete attrs["sessions"];
		
		return attrs;
	},
	
	addSession: function(session) {
		this.get("sessions").add(session);
	},
	
	getStartTimeFormatted: function() {
		var date = new Date(this.get("start"));
		return date.toLocaleDateString() + " " + date.toLocaleTimeString();
	},
	
	url: function() {
		// okay this is sort of stupid, but we want to have a fixed width 
		// url because that makes it easier to match events from redis with
		// the loader. We want to use ??? selectors instead of *, which 
		// matches /event/id/session/id as well as /event/id
		return this.urlRoot + "/" + pad(this.id, 5);
	}
});

exports.EventList = Backbone.Collection.extend({
	model:exports.Event
})


exports.Session = Backbone.Model.extend({
	idRoot: "session",
	
	defaults: function() {
		return {
			title: "Great Session",
			description: "This session is really wonderful.",
			attendee_ids: []
		}
	},
	
	numAttendees: function() {
		return this.get("attendee_ids").length;
	},
	
	addAttendee: function(user) {
		this.get("attendee_ids").push(user.id);
	}
});

exports.SessionList = Backbone.Collection.extend({
	model:exports.Session,
	
	initialize: function(event) {
		this.event = event;
	},
	
	url: function() {
		return this.event.url() + "/sessions";
	},
});


exports.User = Backbone.Model.extend({
	idRoot: "user",
	urlRoot: "user"
});

exports.UserList = Backbone.Collection.extend({
	model:exports.User
});

function pad(n, width, z) {
  z = z || '0';
  n = n + '';
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}


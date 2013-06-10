// This is include-able both in a browser environment and in a v8/node env,
// so it needs to figure out which situation it is in. If it's on the server,
// put everything in exports and behave like a module. If it's on the client,
// fake it and expect the client to understand how to deal with things.
var _ = require('underscore'),
    Backbone = require('backbone');
    
exports.Event = Backbone.Model.extend({
	urlRoot: "event",
	
	defaults: function() {
		// also need:
		// 	1. Some sort of image.
		return {
			title: "My Great Event",
			organizer: "MIT Media Lab",
			description: "This is my description about this great event. It has wonderful sessions in it.",
			start: new Date().getTime(),
			end: new Date().getTime()+60*60*2,
			connectedUsers: new exports.UserList(),
			sessions: new exports.SessionList()
		}
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
		return attrs;
	},
	
	getStartTimeFormatted: function() {
		var date = new Date(this.get("start"));
		return date.toLocaleDateString() + " " + date.toLocaleTimeString();
	}
});

exports.EventList = Backbone.Collection.extend({
	model:exports.Event
})


exports.Session = Backbone.Model.extend({
	urlRoot: "session",
	
	defaults: function() {
		return {
			title: "Great Session",
			description: "This session is really wonderful.",
			attendee_ids: []
		}
	}
});

exports.SessionList = Backbone.Model.extend({
	model:exports.Session
});


exports.User = Backbone.Model.extend({
	urlRoot: "user"
});

exports.UserList = Backbone.Collection.extend({
	model:exports.User
});


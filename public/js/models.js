(function () {
  var server = false,
		models, Backbone;
		
  if (typeof exports !== 'undefined') {
    models = exports;
    server = true;

	// This is include-able both in a browser environment and in a v8/node env,
	// so it needs to figure out which situation it is in. If it's on the server,
	// put everything in exports and behave like a module. If it's on the client,
	// fake it and expect the client to understand how to deal with things.
	var _ = require('underscore')._,
	    Backbone = require('backbone');
  } else {
    models = this.models = {};

	// I'm a little unclear about why I need to do this, but if I don't,
	// Backbone isn't available in scope here. 
	Backbone = window.Backbone;
	_ = window._;
  }
    
models.Event = Backbone.Model.extend({
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
		this.set("sessions", new models.SessionList(null, this));
		this.set("connectedUsers", new models.UserList());
	},
	
	isLive: function() {
		var curTime = new Date().getTime();
		return curTime > this.get("start") && curTime < this.get("end");
	},
		
	numUsersConnected: function() {
		return this.get("connectedUsers").length;
	},
	
	toJSON: function() {
		var attrs = _.clone(this.attributes);
		
		// delete transient attributes that shouldn't
		// be saved to redis.
		delete attrs["connectedUsers"];
		
		// for now just delete sessions; they'll save separately and will know their
		// event by id + url.
		delete attrs["sessions"];
		
		return attrs;
	},
	
	toClientJSON: function() {
		return _.clone(this.attributes);
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

models.EventList = Backbone.Collection.extend({
	model:models.Event
})


models.Session = Backbone.Model.extend({
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
		var attendee_ids = _.clone(this.get("attendee_ids"));
		attendee_ids.push(user.id);
		this.set("attendee_ids", attendee_ids);
		
	}
});

models.SessionList = Backbone.Collection.extend({
	model:models.Session,
	
	url: function() {
		console.log("GETTING LOCAL SESSION LISTe;")
		return "WAT";
	}
});


models.User = Backbone.Model.extend({
	initialize: function() {
		// copy some bonus fields out of the attributes if present.
		if("_json" in this.attributes) {
			var json = this.get("_json");
			
			if("picture" in json) { this.set("picture", this.get("_json").picture); }
			else { this.set("picture", "")}
			
			if("link" in json) this.set("link", this.get("_json").link);
		}
	}
});

models.UserList = Backbone.Collection.extend({
	model:models.User
});

function pad(n, width, z) {
  z = z || '0';
  n = n + '';
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}

})()



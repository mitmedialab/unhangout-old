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

// this is a stupid little shim to deal with not having the pagination module working.
// there should be some way to include it here, but I can't see to work it out.
if(server) {
    Backbone.Paginator = {};

    Backbone.Paginator.clientPager = Backbone.Collection;
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
			sessions: null,
			youtubeEmbed: null
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
	},
	
	setEmbed: function(ytId) {
		this.set("youtubeEmbed", ytId);
	},

	hasEmbed: function() {
		return this.has("youtubeEmbed") && this.get("youtubeEmbed").length>0;
	}
});

models.EventList = Backbone.Collection.extend({
	model:models.Event
});

models.Session = Backbone.Model.extend({
	idRoot: "session",
	MAX_ATTENDEES: 10,
	
	defaults: function() {
		return {
			title: "Great Session",
			description: "This session is really wonderful.",
			attendeeIds: [],
			firstAttendee: null,
			started: false,
			stopped: false
		};
	},
	
	numAttendees: function() {
		return this.get("attendeeIds").length;
	},
	
	addAttendee: function(user) {
		if(this.get("attendeeIds").length==this.MAX_ATTENDEES) {
			return new Error("already at max attendees");
		}
		
		var attendeeIds = _.clone(this.get("attendeeIds"));
		
		if(attendeeIds.indexOf(user.id)==-1) {
			attendeeIds.push(user.id);
			this.set("attendeeIds", attendeeIds);
			this.trigger("change");
			this.trigger("change:attendeeIds");
		} else {
			return new Error("user already attending session");
		}
	},
	
	removeAttendee: function(user) {
		var attendeeIds = _.clone(this.get("attendeeIds"));
		
		var index = attendeeIds.indexOf(user.id);
		if(index==-1) {
			return new Error("user not attending this session");
		} else {
			attendeeIds.splice(index, 1);
			this.set("attendeeIds", attendeeIds);
			this.trigger("change");
			this.trigger("change:attendeeIds");
		}
	},
	
	isAttending: function(userId) {
		return this.get("attendeeIds").indexOf(userId)!=-1;
	},
	
	setFirstAttendee: function(user) {
		this.set("firstAttendee", user);
		this.trigger("change");
	},
	
	start: function() {
		this.set("started", new Date().getTime());
		this.trigger("start");
	},

	stop: function() {
		this.set("stopped", new Date().getTime());
		this.trigger("stopped");
	},

	isLive: function() {
		return this.get("started") && !this.get("stopped");
	}
});

models.SessionList = Backbone.Collection.extend({
	model:models.Session,
	
	url: function() {
		console.log("GETTING LOCAL SESSION LIST");
		return "WAT";
	}
});

models.PaginatedSessionList = Backbone.Paginator.clientPager.extend({
	model:models.Session,

	paginator_ui: {
		firstPage: 1,

		currentPage: 1,
		perPage: 6,
		totalPages: 10,
		pagesInRange: 4
	}
});

models.User = Backbone.Model.extend({

	default: function() {
		return {picture: "", admin:false}
	},
	
	initialize: function() {
		this.checkJSON();
		this.on("change:_json", this.checkJSON)
	},
	
	checkJSON: function() {
		if(this.has("_json")) {
			var json = this.get("_json");

			if("picture" in json) { 
				this.set("picture", json.picture);
			}
			else { this.set("picture", "")}

			if("link" in json) this.set("link", this.get("_json").link);
		}		
	},
	
	isAdmin: function() {
		return this.get("admin");
	},

	getShortDisplayName: function() {
		// the goal here is to return first name, last initial
		// minor catch: we want to special handle last names that are hyphenated and turn
		// Alice-Bob -> A-B

		var names = this.get("displayName").split(" ");

		var shortDisplayName = names[0];

		_.each(names.slice(1, names.length), function(name) {

			if(name.indexOf("-")==-1) {
				// if we don't find a dash, just take the first letter
				shortDisplayName = shortDisplayName + " " + name.slice(0, 1);				
			} else {
				// if we do find a dash, then split on the dash and take the first letter of 
				// each.
				var hyphenatedNames = name.split("-");

				shortDisplayName = shortDisplayName + " " + hyphenatedNames[0].slice(0, 1) + "-" + hyphenatedNames[1].slice(0, 1);
			}
		});

		return shortDisplayName;
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


models.ChatMessage = Backbone.Model.extend({
	default: function() {
		return {
			text: "This is my awesome chat message.",
			time: new Date().getTime(),
			user: null
		};
	},
	
	initialize: function() {
		if(_.isUndefined(this.get("time"))) {
			this.set("time", new Date().getTime());
		}
	}
});

models.ChatMessageList = Backbone.Collection.extend({
	model:models.ChatMessage
});

})()



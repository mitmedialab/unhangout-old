// This is include-able both in a browser environment and in a v8/node env,
// so it needs to figure out which situation it is in. If it's on the server,
// put everything in exports and behave like a module. If it's on the client,
// fake it and expect the client to understand how to deal with things.
var _ = require('underscore'),
    Backbone = require('backbone');
    
exports.Event = Backbone.Model.extend({
	
	defaults: function() {
		// also need:
		// 	1. Some sort of image.
		return {
			title: "My Great Event",
			organizer: "MIT Media Lab",
			description: "This is my description about this great event. It has wonderful sessions in it."
		}
	}
});

exports.Session = Backbone.Model.extend({
	defaults: function() {
		return {
			title: "Great Session",
			description: "This session is really wonderful.",
			attendee_ids: []
		}
	}
});

exports.User = Backbone.Model.extend({
	
});


// Some slight variations on the models that run only on the client.
// Nothing major, just some events.

models.ClientSessionList = models.SessionList.extend({	

	initialize: function(options) {
		models.SessionList.prototype.initialize.call(this, options);

		this.on("add", _.bind(function(session) {
			session.on("change:attendeeIds", _.bind(function() {
				this.sort();
				this.trigger("change");
			}, this));
		}, this));
	},

	comparator: function(a, b) {
		if(a.isAttending(USER_ID)) {
			return -1;
		} else if(b.isAttending(USER_ID)) {
			return 1;
		} else {
			return 0;
		}
	}
});

models.ClientEvent = models.Event.extend({
	initialize: function() {
		models.Event.prototype.initialize.call(this);

		this.set("sessions", new models.ClientSessionList(null, this));
	},
});
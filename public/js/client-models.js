

models.ClientSessionList = models.SessionList.extend({	
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
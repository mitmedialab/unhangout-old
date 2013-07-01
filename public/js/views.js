
var SessionView = Marionette.ItemView.extend({
	template: '#session-template',
	className: 'session span3',
	firstUserView: null,
	
	ui: {
		attend: '.attend',
		start:'.start'
	},
	
	events: {
		'click .attend':'attend',
		'click .start':'start',		
	},
	
	initialize: function() {
		console.log("initializing session view, model: " + JSON.stringify(this.model));
		if(!_.isNull(this.model.get("firstAttendee"))) {
			console.log("setting up first user view");
			this.firstUserView = new UserView({model:new models.User(this.model.get("firstAttendee"))});
		} else {
			console.log("Missing first attendee.");
		}
		
		this.listenTo(this.model, 'change', this.render, this);
		this.listenTo(this.model, 'change:firstAttendee', function() {
			this.firstUserView = new UserView({model:new models.User(this.model.get("firstAttendee"))});
		}, this);
		this.listenTo(this.model, 'started', this.render, this);
		
	},
	
	onRender: function() {
		console.log("on render");
		// things to do here:
		// 1. Hide attending if no one is attending
		// 2. If numAttending > 0, pick the first person and put their icon in .first
		// 3. manage the counter bars for the rest of the count.
		var numAttendees = this.model.numAttendees();
		if(numAttendees==0) {
			this.$el.find(".attending").hide();
			this.$el.find(".empty").show();
		} else {
			this.$el.find(".attending").show();
			this.$el.find(".empty").hide();
			
			// console.log("about to make a user view for the firstUser: " + JSON.stringify(this.model.get("firstAttendee")));
			// var firstUserView = new UserView({model:new models.User(this.model.get("firstAttendee"))});
			if(!_.isNull(this.firstUserView)) {
				if(!_.isUndefined(this.firstUserView.model.get("picture"))) {
					this.$el.find(".first").append(this.firstUserView.render().el);
				}
			}
			
			var count = 0;
			this.$el.find(".attending").children().each(function(index, el) {
				if(count < numAttendees) {
					$(el).addClass("selected");
					console.log(el);
				} else {
					$(el).removeClass("selected");
				}
				
				count ++;
			});
		}
		
		console.log("started: " + this.model.get("started"));
		if(this.model.get("started")) {
			this.$el.find(".started").show();
		} else {
			this.$el.find(".started").hide();			
		}
		
		if(this.model.numAttendees()==this.model.MAX_ATTENDEES) {
			this.$el.find(".full").show();
		} else {
			this.$el.find(".full").hide();			
		}
		
		if(IS_ADMIN) {
			// show the admin UI. obviously, requests generated here are authenticated
			// on the server, so doesn't matter if users mess around and show these
			// buttons covertly.
			this.$el.find(".admin").show();
		} else {
			this.$el.find(".admin").hide();			
		}
		
		if(this.model.isAttending(USER_ID)) {
			this.ui.attend.addClass("active");
			this.ui.attend.find(".text").text("JOINED");
		} else {
			this.ui.attend.removeClass("active");
			this.ui.attend.find(".text").text("JOIN");
		}
	},
	
	destroy: function() {
		this.model.destroy();
	},
		
	attend: function() {
		console.log("attend pressed on " + this.model.id);

		if(this.ui.attend.hasClass("active")) {
			this.ui.attend.text("JOIN");
			var message = {type:"unattend", args:{id:this.model.id}};
			sock.send(JSON.stringify(message));				
		} else {
			var message = {type:"attend", args:{id:this.model.id}};
			sock.send(JSON.stringify(message));	
		}		
	},
	
	start: function() {
		var message = {type:"start", args:{id:this.model.id}};
		sock.send(JSON.stringify(message));
	}
});

var SessionListView = Backbone.Marionette.CompositeView.extend({
	template: "#session-list-template",
	itemView: SessionView,
	itemViewContainer: '#session-list-container',
	id: "session-list",
	
	initialize: function() {
		this.listenTo(this.collection, 'all', this.update, this);
	},
	
	onRender: function() {
		this.update();
	},
	
	update: function() {
		// ?? don't think we need this.
		console.log("update");
	},
})

var UserView = Marionette.ItemView.extend({
	template: '#user-template',
	className: 'user',
	
	events: {
		'click' : 'click'
	},
	
	initialize: function() {
		this.listenTo(this.model, 'change', this.render, this);
	},	
	
	click: function() {
		console.log("user clicked: " + this.model.get("displayName"));
	},
	
	onRender: function() {
		// add in the tooltip attributes
		this.$el.attr("data-toggle", "tooltip");
		this.$el.attr("title", this.model.get("displayName"));
		this.$el.tooltip();
	}
});

var UserListView = Backbone.Marionette.CompositeView.extend({
	template: '#user-list-template',
	itemView: UserView,
	itemViewContainer: "#user-list-container",
	id: "user-list",
	
	initialize: function() {
		this.listenTo(this.collection, 'all', this.update, this);
	}
});

var ChatMessageView = Marionette.ItemView.extend({
	template: '#chat-message-template',
	className: 'chat-message',
	
});

var ChatView = Marionette.CompositeView.extend({
	template: '#chat-template',
	itemView: ChatMessageView,
	itemViewContainer: "#chat-list-container",
	id: "chat",
	
	ui: {
		chatInput: "#chat-input"
	},
	
	events: {
		'submit form':'chat'
	},
	
	initialize: function() {
		this.listenTo(this.collection, 'all', this.update, this);
	},
	
	update: function() {
		this.$el.find("#chat-container").scrollTop($("#chat-container")[0].scrollHeight);
	},	
	
	chat: function(e) {
		var msg = this.ui.chatInput.val();
		sock.send(JSON.stringify({type:"chat", args:{text:msg}}));
		this.ui.chatInput.val("");
		e.preventDefault();
		return false;
	}
});













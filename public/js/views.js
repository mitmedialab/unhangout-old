
var SessionView = Marionette.ItemView.extend({
	template: '#session-template',
	className: 'session span3',
	
	ui: {
		attend: '.btn'
	},
	
	events: {
		'click .btn':'attend'
	},
	
	initialize: function() {
		this.listenTo(this.model, 'change', this.render, this);
	},
	
	onRender: function() {
		// things to do here:
		// 1. Hide attending if no one is attending
		// 2. If numAttending > 0, pick the first person and put their icon in .first
		// 3. manage the counter bars for the rest of the count.
		var numAttendees = this.model.numAttendees();
		if(numAttendees==0) {
			this.$el.find(".attending").hide();
		} else {
			this.$el.find(".attending").show();
			
			this.$el.find(".first").append($("<img src='" + this.model.get("firstAttendee").picture + "'>"))
			
			var count = 0;
			this.$el.find(".attending").children().each(function(index, el) {
				console.log("checking child")
				if(count < numAttendees) {
					console.log("adding class");
					$(el).addClass("selected");
					console.log(el);
				} else {
					$(el).removeClass("selected");
				}
				
				count ++;
			});
		}
	},
	
	destroy: function() {
		this.model.destroy();
	},
	
	attend: function() {
		console.log("attend pressed on " + this.model.id);
		var message = {type:"attend", args:{id:this.model.id}};
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
	
	initialize: function() {
		this.listenTo(this.model, 'change', this.render, this);
	},	
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













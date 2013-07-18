
var SessionView = Marionette.ItemView.extend({
	template: '#session-template',
	className: 'session',
	firstUserView: null,
	mini: true,

	ui: {
		attend: '.attend',
		start:'.start',
		joinDialog:'.started-modal',
		attending: '.attending',
		empty: '.empty',
		description: '.description'
	},

	events: {
		'click .attend':'attend',
		'click .start':'start',
		'click a.join-chosen-session':'joined',
		'click h3':'headerClick'
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
		this.listenTo(this.model, 'change:session-key', function() {
			if(!this.model.isAttending(USER_ID)) {
				console.log("skipping dialog for a non-attending user");
				return;
			}
			
			console.log("got start message!");
			this.ui.joinDialog.find("a").attr("href", "/session/" + this.model.get("session-key"));
			this.ui.joinDialog.modal('show');
			setTimeout(_.bind(function() {
				console.log("running hide");
				$(".modal.in").modal("hide");
				// this.ui.joinDialog.modal('hide');
			}, this), 10000);
			
		}, this);		
	},
	

	onRender: function() {
		// things to do here:
		// 1. Hide attending if no one is attending
		// 2. If numAttending > 0, pick the first person and put their icon in .first
		// 3. manage the counter bars for the rest of the count.

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
			// this.ui.attend.find(".text").text("JOINED");
			this.$el.find(".joined").show();
		} else {
			this.ui.attend.removeClass("active");
			this.$el.find(".joined").hide();
			// this.ui.attend.find(".text").text("JOIN");
		}

		if(this.model.get("started")) {
			this.$el.find(".started").show();

			// remove the toggle-ness of the button once the event starts.
			this.ui.attend.attr("data-toggle", "");
			this.ui.attend.removeClass("btn-info");			
			this.ui.attend.removeClass("active");
			this.ui.attend.addClass("btn-success");
		} else {
			this.$el.find(".started").hide();			
		}

		// check and see if we're in mini mode. If we are, hide the description and attendee counting in large form.
		if(this.mini) {
			this.ui.description.hide();
			this.ui.empty.hide();
			this.ui.attending.hide();
		} else {
			this.ui.description.show();
			this.ui.empty.show();
			this.ui.attending.show();

			// if(this.model.numAttendees()==this.model.MAX_ATTENDEES) {
			// 	this.$el.find(".full").show();
			// } else {
			// 	this.$el.find(".full").hide();			
			// }

			// if(!_.isNull(this.firstUserView)) {
			// 	if(!_.isUndefined(this.firstUserView.model.get("picture"))) {
			// 		this.$el.find(".first").append(this.firstUserView.render().el);
			// 	}
			
			// 	var count = 0;
			// 	this.$el.find(".attending").children().each(function(index, el) {
			// 		if(count < numAttendees) {
			// 			$(el).addClass("selected");
			// 		} else {
			// 			$(el).removeClass("selected");
			// 		}
				
			// 		count ++;
			// 	});
			// }
		}

		var numAttendees = this.model.numAttendees();

		this.$el.find(".attend-count").text("(" + numAttendees + " of " + this.model.MAX_ATTENDEES + ")");
		this.$el.find(".attendance").css("width", ((numAttendees / this.model.MAX_ATTENDEES)*100) + "%");

	},

	destroy: function() {
		this.model.destroy();
	},

	attend: function() {
		console.log("attend pressed on " + this.model.id);

		if(this.model.get("started")) {
			// if the event has started, button presses should attempt to join
			// the hangout.
			var url = "/session/" + this.model.get("session-key");
			window.open(url);
		} else {
			if(this.ui.attend.hasClass("active")) {
				this.ui.attend.text("JOIN");
				var message = {type:"unattend", args:{id:this.model.id}};
				sock.send(JSON.stringify(message));				
			} else {
				var message = {type:"attend", args:{id:this.model.id}};
				sock.send(JSON.stringify(message));	
			}		
		}

	},

	start: function() {
		sock.send(JSON.stringify({type:"start", args:{id:this.model.id}}));
	},

	headerClick: function() {
		// for now disabling the macro style view entirely
		// this.mini = !this.mini;
		// this.render();
	}
});

var SessionListView = Backbone.Marionette.CollectionView.extend({
	template: "#session-list-template",
	itemView: SessionView,
	itemViewContainer: '#session-list-container',
	id: "session-list",

	events: {
		'click #prev':'previous',
		'click #next':'next',
		'click .page':'goto'
	},

	initialize: function() {
		console.log("INITIALIZE");
		setTimeout(_.bind(this.updateDisplay, this), 100);

		$(window).resize(_.bind(function() {
			this.updateDisplay();
		}, this));
	},

	previous: function() {
		this.collection.prevPage();
		this.render();
	},

	next: function() {
		this.collection.nextPage();
		this.render();
	},

	goto: function(e) {
		this.collection.goTo(parseInt($(e.target).text()));
		this.render();
	},

	updateDisplay: function() {
		// figure out how tall a session is.
		var exampleSessionHeight = this.$el.find(".session").first().outerHeight()

		if(exampleSessionHeight< 10) {
			return;
		}

		// figure out how many we can fit safely, rounding down
		var height = this.$el.parent().innerHeight() - 75;

		var sessionsPerPage = Math.floor(height / exampleSessionHeight) * 2;

		console.log("SETTING SESSIONS PER PAGE: " + sessionsPerPage);

		if(this.collection.perPage != sessionsPerPage) {
			this.collection.howManyPer(sessionsPerPage);
			this.render();
		}
	},

	onRender: function() {
		this.$el.find(".footer").remove();
		if(this.collection.info().pageSet.length >1) {
			var template = _.template($("#pagination-template").text(), this.collection);

			this.$el.append(template);
			this.delegateEvents();
		}
	}
})

var UserView = Marionette.ItemView.extend({
	template: '#user-template',
	className: 'user',
	tagName: "li",

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
		this.$el.attr("data-placement", "left");
		this.$el.attr("data-container", "#presence-gutter");
		this.$el.attr("title", this.model.get("displayName"));
		this.$el.tooltip();
	}
});

var DialogView = Backbone.Marionette.Layout.extend({
	template: "#dialogs-template",

	id: "dialogs",

	events: {
		'click #set-embed':'setEmbed'
	},

	setEmbed: function() {
		var message = {type:"embed", args:{ytId:$("#youtube_id").val()}};
		sock.send(JSON.stringify(message));
	}

})

var AdminButtonView = Backbone.Marionette.Layout.extend({
	template: "#admin-button-template",

	id: "admin-button",

	events: {
		'click #start-all':'startAll'
	},

	startAll: function() {
		console.log("start all!");
	}
});

var UserColumnLayout = Backbone.Marionette.Layout.extend({
	template: "#user-column-layout-template",

	id: "user-column",

	userListView: null,

	regions: {
		userList: "#user-list",
		footer: "#footer"
	},

	initialize: function() {
		this.userListView = new UserListView({collection:this.options.users});
	},

	onRender: function() {
		this.userList.show(this.userListView);
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

var ChatLayout = Backbone.Marionette.Layout.extend({
	template: '#chat-layout',
	id: 'chat',
	className: "full-size-container",

	regions: {
		chat:'#chat-container',
		presence: '#presence-gutter'
	},

	initialize: function() {
		this.chatView = new ChatView({collection:this.options.messages});
		this.userListView = new UserListView({collection:this.options.users});

		console.log("initializing chat layout with: " + JSON.stringify(this.options.messages));
		console.log("and users: " + JSON.stringify(this.options.users));
	},

	onRender: function() {
		this.chat.show(this.chatView);
		this.presence.show(this.userListView);
	},

})

var ChatMessageView = Marionette.ItemView.extend({
	template: '#chat-message-template',
	className: 'chat-message'
});

var ChatView = Marionette.CompositeView.extend({
	template: '#chat-template',
	itemView: ChatMessageView,
	itemViewContainer: "#chat-list-container",
	id: "chat-container",

	events: {
		'submit form':'chat'
	},

	ui: {
		chatInput: "#chat-input"
	},

	initialize: function() {
		this.listenTo(this.collection, 'all', this.update, this);
	},

	chat: function(e) {
		var msg = this.ui.chatInput.val();
		sock.send(JSON.stringify({type:"chat", args:{text:msg}}));
		this.ui.chatInput.val("");
		e.preventDefault();
		return false;
	},

	update: function() {
		this.$el.find("#chat-container").scrollTop($("#chat-container")[0].scrollHeight);
	}
});

var VideoEmbedView = Marionette.ItemView.extend({
	template: '#video-embed-template',
	id: 'video-embed',

	player: null,

	initialize: function() {
		this.listenTo(this.model, "change:youtubeEmbed", this.render, this);
	},

	onShow: function() {
		if(_.isNull(this.model.get("youtubeEmbed")) || this.model.get("youtubeEmbed").length!=11) {
			this.$el.hide();
		} else {
			this.$el.show();
			this.$el.draggable();
			// do the actual YT embed code here
			this.player = new YT.Player('player', {
				height: 200,
				// width: this.dimensions['small'].width,
				videoId: this.model.get("youtubeEmbed"),
				controls: 0,
				events: {
					"onReady": function(args) {
						console.log("video ready!");
					},
					"onStateChange": function(args) {
						console.log("state change");
					}
				}
			});

			// this.$el.css("height", this.dimensions['small'].height + 40);
		}
	}
});

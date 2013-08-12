
var SessionView = Marionette.ItemView.extend({
	template: '#session-template',
	className: 'session',
	firstUserView: null,
	mini: true,

	ui: {
		attend: '.attend',
		start:'.start',
		attending: '.attending',
		empty: '.empty',
		description: '.description'
	},

	events: {
		'click .attend':'attend',
		'click .start':'start',
		'click h3':'headerClick'
	},

	initialize: function() {

		this.listenTo(this.model, 'change', this.render, this);
		this.listenTo(this.model, 'change:session-key', function() {
			if(!this.model.isAttending(USER_ID)) {
				console.log("skipping dialog for a non-attending user");
				return;
			}
			
			console.log("got start message!");
			$(".started-modal").find("a").attr("href", "/session/" + this.model.get("session-key"));
			$(".started-modal").find("h3").text(this.model.get("title") + " IS STARTING");
			$(".started-modal").modal('show');

			setTimeout(_.bind(function() {
				console.log("running hide");
				$(".modal.in").modal("hide");
				// this.ui.joinDialog.modal('hide');
			}, this), 60000);
		}, this);	

		// this.listenTo(this.model, 'stopped', this)

	},

	onRender: function() {
		// things to do here:
		// 1. Hide attending if no one is attending
		// 2. manage the counter bars for the rest of the count.

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

		if(this.model.isLive()) {
			this.$el.find(".started").show();

			// remove the toggle-ness of the button once the event starts.
			this.ui.attend.attr("data-toggle", "");
			this.ui.attend.removeClass("btn-info");			
			this.ui.attend.removeClass("active");
			this.ui.attend.addClass("btn-success");

			this.ui.attend.find(".text").text("JOIN");

			// don't show the x of 10 when it's live (at least until we have live data for that)
			this.ui.attend.find(".attend-count").hide();
		} else {
			this.$el.find(".started").hide();			
			this.ui.attend.find(".text").text("SIGN UP");
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
		}

		if(this.model.get("stopped")) {
			this.ui.attend.attr("disabled", true);
			this.ui.attend.addClass("disabled");

			this.$el.undelegate('.attend', 'click');

			this.$el.find(".start").hide();

			this.ui.attend.find(".text").text("SESSION FINISHED");
			this.ui.attend.find(".attend-count").hide();

		} else {
			this.$el.find(".attend").attr("disabled", false);
			this.$el.find(".attend").removeClass("disabled");

			this.$el.delegate('.attend', 'click');

			this.$el.find(".start").show();
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

		if(this.model.isLive()) {
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
				app.vent.trigger("attend", this.model.id);
			}		
		}

	},

	start: function() {
		sock.send(JSON.stringify({type:"start", args:{id:this.model.id}}));
	},
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
		
		if(sessionsPerPage < 2) {
			sessionsPerPage = 2;
		}

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
		this.listenTo(this.model, 'change:isBlurred', this.render, this);
	},	

	click: function() {
		console.log("user clicked: " + this.model.get("displayName"));
	},

	onRender: function() {
		// add in the tooltip attributes	
		if(this.model.isAdmin()) {
		 	this.$el.addClass("admin");
		}

		if(this.model.isBlurred()) {
			this.$el.addClass("blur");
			this.$el.removeClass("focus");
		} else {
			this.$el.removeClass("blur");
			this.$el.addClass("focus");
		}

		this.$el.attr("data-toggle", "tooltip");
		this.$el.attr("data-placement", "left");
		this.$el.attr("data-container", "#chat-container-region");
		this.$el.attr("title", this.model.get("displayName"));
		this.$el.tooltip();
	}
});

var DialogView = Backbone.Marionette.Layout.extend({
	template: "#dialogs-template",

	id: "dialogs",

	events: {
		'click #set-embed':'setEmbed',
		'click #disconnected-modal a':'closeDisconnected'
	},

	setEmbed: function() {
		var newId = $("#youtube_id").val();

		if(newId.length!=11) {
			this.$el.find("#embed-modal p.text-warning").removeClass("hide");
			this.$el.find("#embed-modal .control-group").addClass("error");
		} else {
			this.$el.find("#embed-modal p.text-warning").addClass("hide");
			this.$el.find("#embed-modal .control-group").removeClass("error");
			var message = {type:"embed", args:{ytId:newId}};
			sock.send(JSON.stringify(message));
		}
	},

	closeDisconnected: function() {
		$("#disconnected-modal").modal('hide');
	}
})

var AdminButtonView = Backbone.Marionette.Layout.extend({
	template: "#admin-button-template",

	id: "admin-button",

	firstRun: true,

	events: {
		'click #show-embed-modal':'showEmbedModal',
		'click #start-all':'startAll',
		'click #stop-all':'stopAll'
	},

	startAll: function() {
		console.log("start all!");
	},

	stopAll: function() {
		console.log("stop all!");
		sock.send(JSON.stringify({type:"stop-all", args:{}}));
	},

	showEmbedModal: function() {
		$("#youtube_id").val(curEvent.get("youtubeEmbed"));
	},

	onRender: function() {
		if(this.firstRun && NUM_HANGOUTS_FARMED==0) {
			$("#no-urls-warning").modal('show');
		}
	},

	serializeData: function() {
		return {numFarmedHangouts:NUM_HANGOUTS_FARMED};
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

	events: {
		'click .pageUp':'pageUp',
		'click .pageDown':'pageDown'
	},

	initialize: function() {
		this.listenTo(this.collection, 'add remove', function() {
			// going to manually update the current user counter because
			// doing it during render doesn't seem to work. There's some 
			// voodoo in how marionette decides how much of the view to
			// re-render on events, and it seems to excludethe piece out-
			// side the item-view-container, assuming it doesn't have
			// reactive bits.
			// I would also expect this to be .totalRecords, but for
			// some reason totalRecords doesn't decrease when records
			// are removed, but totalUnfilteredRecords does. Could
			// be a bug.

			// Other side note: be aware that there is some magic in
			// marionette around adding to collections. It apparently
			// tries to just auto-add the new record to the 
			// itemViewContainer. This is a little weird when
			// combined with the pagination system, which doesn't 
			// necessarily show all incoming models. Just something
			// to keep an eye on. More info here:
			// https://github.com/marionettejs/backbone.marionette/blob/master/docs/marionette.compositeview.md#model-and-collection-rendering

			this.$el.find(".header .contents").text(this.collection.info().totalUnfilteredRecords);
		}, this);


		$(window).resize(_.bind(function() {
			this.updateDisplay();
		}, this));
	},

	serializeData: function() {
		var data = {};

		data = this.collection.toJSON();

		data["numUsers"] = this.collection.info().totalRecords;

		console.log("running user list serialize data");
		return data;
	},

	update: function() {
		console.log("rendering UserListView");
		this.render();
	},

	updateDisplay: function() {
		// figure out how tall a session is.
		var exampleUserHeight = this.$el.find(".user").first().outerHeight();

		if(exampleUserHeight< 10) {
			return;
		}

		// figure out how many we can fit safely, rounding down
		var height = this.$el.parent().innerHeight() - 75;

		var userPerPage = Math.floor(height / exampleUserHeight);

		if(this.collection.perPage != userPerPage) {
			this.collection.howManyPer(userPerPage);
			this.render();
		}
	},

	// onRender: function() {
	// 	console.log("post render");
	// },

	pageUp: function() {
		console.log("page up");
		this.collection.prevPage();
		this.render();
	},

	pageDown: function() {
		console.log("page down");
		this.collection.nextPage();
		this.render();
	},
});

var ChatLayout = Backbone.Marionette.Layout.extend({
	template: '#chat-layout',
	id: 'chat',
	className: "full-size-container",

	regions: {
		chat:'#chat-container-region',
		presence: '#presence-gutter',
		chatInput: '#chat-input-region'
	},

	initialize: function() {
		this.chatView = new ChatView({collection:this.options.messages});
		this.userListView = new UserListView({collection:this.options.users});
		this.chatInputView = new ChatInputView();

		console.log("initializing chat layout with: " + JSON.stringify(this.options.messages));
		console.log("and users: " + JSON.stringify(this.options.users));
	},

	onRender: function() {
		this.chat.show(this.chatView);
		this.presence.show(this.userListView);
		this.chatInput.show(this.chatInputView);
	},
})

var ChatInputView = Marionette.ItemView.extend({
	template: '#chat-input-template',

	events: {
		'submit form':'chat'
	},

	ui: {
		chatInput: "#chat-input"
	},

	initialize: function(options) {
		Marionette.View.prototype.initialize.call(this, options);
	},

	chat: function(e) {
		var msg = this.ui.chatInput.val();
		sock.send(JSON.stringify({type:"chat", args:{text:msg}}));
		this.ui.chatInput.val("");
		e.preventDefault();
		return false;
	}
});

var ChatMessageView = Marionette.ItemView.extend({
	template: '#chat-message-template',
	className: 'chat-message',

	initialize: function() {
		this.model.set("text", this.linkify(this.model.get("text")));
	},

	linkify: function(msg) {
		var replacedText, replacePattern1, replacePattern2, replacePattern3, replacePattern4;

    	//URLs starting with http://, https://, or ftp://
     	replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
     	replacedText = msg.replace(replacePattern1, "<a href='$1' target='_new'>$1</a>");

     	//URLs starting with "www." (without // before it, or it'd re-link the ones done above).
     	replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
     	replacedText = replacedText.replace(replacePattern2, "$1<a href='http://$2' target='_new'>$2</a>");

     	//Change email addresses to mailto:: links.
     	replacePattern3 = /(([a-zA-Z0-9\-?\.?]+)@(([a-zA-Z0-9\-_]+\.)+)([a-z]{2,3}))+$/;
	    replacedText = replacedText.replace(replacePattern3, "<a href='mailto:$1'>$1</a>");

    	return replacedText;
	},

	serializeData: function() {
		var model = this.model.toJSON();

		var tempUser = new models.User(this.model.get("user"));

		model.user["shortDisplayName"] = tempUser.getShortDisplayName();
		return model;
	},

	onRender: function() {
		if(this.model.get("user").admin) {
			this.$el.find(".from").addClass("admin");
		}
	}
});

var ChatView = Marionette.CompositeView.extend({
	template: '#chat-template',
	itemView: ChatMessageView,
	itemViewContainer: "#chat-list-container",
	id: "chat-container",


	initialize: function() {
		this.listenTo(this.collection, 'all', this.update, this);
	},

	update: function() {
		this.$el.scrollTop(this.$el[0].scrollHeight);
	}
});

var SessionLiveView = Marionette.ItemView.extend({
	template: "#session-live-bar-template",
	id: "session-live-bar"
});

var VideoEmbedView = Marionette.ItemView.extend({
	template: '#video-embed-template',
	id: 'video-embed',

	player: null,

	initialize: function() {
		// TODO
		// we need to be more clever about this. if the player is loaded already,
		// just send it to a different youtube id. reloading it entirely doesn't
		// seem to work. In the meantime, just zero videos out between their inclusion.
		this.listenTo(this.model, "change:youtubeEmbed", function(model, youtubeEmbed) {
			// two cases. if the old attribute was empty or null, then just render.
			// if the old attribute is a valid youtube id (ie 11 chars long) then
			// we need to do a YT JS API dance.

			var previous = model.previous("youtubeEmbed");
			if(_.isNull(previous) || previous.length!=11) {
				this.render();
			} else {
				this.player.loadVideoById(youtubeEmbed);
			}
		}, this);
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
		}
	}
});

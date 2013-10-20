// The views in this file define all the major pieces of the client-side UI.
// We are using Marionette for our views, which provides some extra layers on
// top of the basic Backbone view objects. 
//
// You can read more about Marionette's objects here: https://github.com/marionettejs/backbone.marionette/tree/master/docs
//
// Basically, each major model in the system has a corresponding view: sessions,
// users, chat messages, etc. Events are excepted, because the main interface
// is for the entire event. The app itself is basically the event view.
//
// Each view has a matching template (defined in event.ejs) that contains its 
// markup. On top of that, it defines various events (to respond to, eg, clicks
// on its own elements) as well as other on-render behavior to change how
// the view looks in response to changes in its model or other application
// state. 


var SessionView = Marionette.ItemView.extend({
	template: '#session-template',
	className: 'session',
	firstUserView: null,
	mini: true,

	ui: {
		attend: '.attend',
		start:'.start',
		deleteButton: '.delete',		// delete is reserved word
		attending: '.attending',
		empty: '.empty',
		description: '.description',
		hangoutUsers: '.hangout-users',
		hangoutOffline: '.hangout-offline'
	},

	events: {
		'click .attend':'attend',
		'click .start':'start',
		'click .delete':'delete',
		'click h3':'headerClick'
	},

	initialize: function() {

		// if we get a notice that someone has connected to the associated participant,
		// re-render to show them.
		this.listenTo(this.model, 'change change:connectedParticipantIds change:hangoutConnected', this.render, this);

		// changes to session-key are basically a proxy for a session going "live", eg
		// an organizer has marked that session was now running.
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
		// mostly just show/hide pieces of the view depending on 
		// model state.

		if(IS_ADMIN) {
			// show the admin UI. obviously, requests generated here are authenticated
			// on the server, so doesn't matter if users mess around and show these
			// buttons covertly.
			this.$el.find(".admin-buttons").show();
		} else {
			this.$el.find(".admin-buttons").hide();			
		}

		if(this.model.isAttending(USER_ID)) {
			this.ui.attend.addClass("active");
			this.$el.find(".joined").show();
		} else {
			this.ui.attend.removeClass("active");
			this.$el.find(".joined").hide();
		}

		if(this.model.isLive()) {
			this.$el.addClass("live");

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
			this.$el.removeClass("live");

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

		var numAttendees;

		// if we're live, make the bar fill up based on how many people are currently there
		if(this.model.isLive()) {
			numAttendees = this.model.getNumConnectedParticipants();
		} else {
			numAttendees = this.model.numAttendees();
		}

		this.$el.find(".attend-count").text("(" + numAttendees + " of " + this.model.MAX_ATTENDEES + ")");
		this.$el.find(".attendance").css("width", ((numAttendees / this.model.MAX_ATTENDEES)*100) + "%");

		// now check and see if the hangout is communicating properly with the server. if it is, show
		// the hangout-users div, and populate it with users.
		if(this.model.get("hangoutConnected")) {
			this.$el.addClass("hangout-connected");

			this.ui.hangoutUsers.empty();

			_.each(this.model.get("connectedParticipantIds"), _.bind(function(id) {
				// make a new user view and append it here.
				var user = users.get(id);

				if(_.isUndefined(user)) {
					console.log("skipping connected user, because can't find user data for them yet");
					return;
				}

				var userView = new UserView({model:user});

				this.ui.hangoutUsers.append(userView.render().el);
			}, this));

			this.ui.hangoutUsers.show();
			this.ui.hangoutOffline.hide();
		} else {
			this.ui.hangoutUsers.hide();
			this.ui.hangoutOffline.show();
			this.$el.removeClass("hangout-connected");
		}
	},

	destroy: function() {
		this.model.destroy();
	},

	attend: function() {
		console.log("attend pressed on " + this.model.id);
		console.log("model: " + JSON.stringify(this.model));

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

	delete: function() {
		sock.send(JSON.stringify({type:"delete", args:{id:this.model.id}}));
	}
});

// The list view contains all the individual session views. We don't
// manually make the session views - all that is handled by the 
// marionette CollectionView logic. Our primary issue in this class
// is to deal with pagination and its associated rendering issues.

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

	initialize: function(args) {
		Backbone.Marionette.CollectionView.prototype.initialize.call(this, args);

		this.listenTo(this.collection, "sort", function() {
			console.log("collection:sort");
			this.render();
		}, this);
	},

	onRender: function() {

	}
})

// UserViews are the little square profile pictures that we use throughout
// the app to represent users.

var UserView = Marionette.ItemView.extend({
	template: '#user-template',
	className: 'user focus',
	tagName: "li",

	events: {
		'click' : 'click'
	},

	initialize: function(args) {
		Marionette.ItemView.prototype.initialize.call(this, args);

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

		// look for either an img or an i child, since people who don't have
		// a g+ icon should still get tooltips
		this.$el.find("img, i").attr("data-toggle", "tooltip");

		// if we're a child of hangout-users, then we're a small session user icon,
		// not a big presence gutter icon. in this case, make the data container
		// the session.
		if(this.$el.parent().hasClass("hangout-users")) {
			// this.$el.find("img, i").attr("data-container", "#chat-container-region");
			this.$el.find("img, i").attr("data-placement", "top");
		} else {
			this.$el.find("img, i").attr("data-container", "#chat-container-region");
			this.$el.find("img, i").attr("data-placement", "left");
		}

		this.$el.find("img, i").attr("title", this.model.get("displayName"));
		this.$el.find("img, i").tooltip();
	}
});

// The DialogView contains all our dialog boxes. This is a little awkward, but
// when we tried associated dialog boxes with the views that actually trigger them
// we ran into all sorts of z-index issues, because those views were all
// over the DOM and had different situations. Instead, we just put them
// all in one place for easy bootstrap dialog triggering. We also house
// the relevant events related to those dialog boxes here.
var DialogView = Backbone.Marionette.Layout.extend({
	template: "#dialogs-template",

	id: "dialogs",

	events: {
		'click #set-embed':'setEmbed',
		'click #disconnected-modal a':'closeDisconnected',
		'click #create-session':'createSession'
	},

	setEmbed: function() {
		var newId = $("#youtube_id").val();

		if(newId.length!=11 && newId.length!=0) {
			this.$el.find("#embed-modal p.text-warning").removeClass("hide");
			this.$el.find("#embed-modal .control-group").addClass("error");
		} else {
			this.$el.find("#embed-modal p.text-warning").addClass("hide");
			this.$el.find("#embed-modal .control-group").removeClass("error");
			var message = {type:"embed", args:{ytId:newId}};
			sock.send(JSON.stringify(message));
		}
	},

	createSession: function() {
		var title = $("#session_name").val();
		var desc = $("#session_desc").val();

		sock.send(JSON.stringify({type:"create-session", args:{title:title, description:desc}}));

		$("#session_name").val("");
		$("#session_desc").val("");

		$("#create-session-modal").modal('hide');
	},

	closeDisconnected: function() {
		$("#disconnected-modal").modal('hide');
	}
})

// Generates the admin menu items.
var AdminButtonView = Backbone.Marionette.Layout.extend({
	template: "#admin-button-template",

	id: "admin-button",

	firstRun: true,

	events: {
		'click #show-embed-modal':'showEmbedModal',
		'click #start-all':'startAll',
		'click #stop-all':'stopAll',
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
			// $("#no-urls-warning").modal('show');
			console.log("No farmed hangouts available!");
		}
	},

	// this little hack is to make sure the hangout count
	// is available in the template rendering.
	serializeData: function() {
		return {numFarmedHangouts:NUM_HANGOUTS_FARMED};
	}
});

// The UserColumn is the gutter on the right that shows who's connected to the
// unhangout right now. We use a layout to encapsulate it and provide the UI
// around the core set of UserViews. You can read more about layouts in the
// Marionette docs.
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

// The actual core UserListView that manages displaying each individual user.
// This logic is quite similar to the SessionListView, which also deals with
// pagination in a flexible-height space.
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
		// figure out how tall a user is.
		var exampleUserHeight = this.$el.find(".user").first().outerHeight();

		if(exampleUserHeight< 10) {
			return;
		}

		// figure out how many we can fit safely, rounding down
		var height = this.$el.parent().innerHeight() - 75;

		var userPerPage = Math.floor(height / exampleUserHeight);

		console.log("collection.perPage: " + this.collection.perPage);
		console.log("userPerPage: " + userPerPage);
		
		// stop trusting collection.perPage; that seems to vary 
		// depending on how many people are actually available
		// to be shown?

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

// Manages chat message display. The layout piece sets up the differnt chat zones:
// the area where we show messages, the space where we put users, and the space
// where chat messages are entered. 
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

// The input form for sending chat messages.
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
	},

	onRender: function() {
		if(!curEvent.isLive()) {
			this.$el.find("#chat-input").attr("disabled", true);
			this.$el.find("#chat-input").addClass("disabled");			
		} else {
			this.$el.find("#chat-input").removeAttr("disabled");
			this.$el.find("#chat-input").removeClass("disabled");			
		}
	}
});

// The view for an individual chat message.
var ChatMessageView = Marionette.ItemView.extend({
	template: '#chat-message-template',
	className: 'chat-message',

	initialize: function() {
		this.model.set("text", this.linkify(this.model.get("text")));
	},

	// Finds and replaces valid urls with links to that url. Client-side only
	// of course; all messages are sanitized on the server for malicious content.
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

	// We want to use shortNames so we intercept this process to make the short
	// display name visible within the template rendering, since we can't
	// call object methods during that process.
	serializeData: function() {
		var model = this.model.toJSON();

		// if we have a user object (ie if we're not a system generated
		// message) then convert its name to the short display name.
		if(this.model.has("user")) {
			var tempUser = new models.User(this.model.get("user"));
			model.user["shortDisplayName"] = tempUser.getShortDisplayName();
		} else {
			// fill in a sort of fake empty name, just to the templating
			// system doesn't freak out.
			model.user = {shortDisplayName:""};
		}

		return model;
	},

	onRender: function() {

		if(!this.model.has("user")) {
			// mark this chat message as a system message, so we can
			// display it differently.
			this.$el.addClass("system");
		} else if(this.model.get("user").admin) {
			this.$el.find(".from").addClass("admin");
		}

	}
});

// This view contains all the ChatMessageViews and handles scrolling for them.

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

// The bar that appears when your session goes live.
var SessionLiveView = Marionette.ItemView.extend({
	template: "#session-live-bar-template",
	id: "session-live-bar"
});

var AboutEventView = Marionette.ItemView.extend({
	template: "#about-event-template",
	id: "about-event",

	initialize: function() {
		this.listenTo(this.model, 'change:description', _.bind(function() {
			$(".updated").removeClass("hide");
			this.render();
		}, this), this);
	},

	onRender: function() {
		if(this.model.isLive()) {
			this.$el.find(".footer").hide();
		} else {
			this.$el.find(".footer").show();
		}
	},
});

// Manages the display of embedded videos on the upper left corner.
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

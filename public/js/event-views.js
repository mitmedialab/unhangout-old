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

var userViewCache = {};

var SessionView = Marionette.ItemView.extend({
	template: '#session-template',
	className: 'session',
	firstUserView: null,
	ui: {
		attend: '.attend',
		start:'.start',
		deleteButton: '.delete',		// delete is reserved word
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
		this.listenTo(this.model, 'change:connectedParticipants change:hangoutConnected', this.render, this);
	},

	onRender: function() {
		var start = new Date().getTime();
        this.$el.attr("data-session-id", this.model.id);
        console.log("render SessionView", _.pluck(this.model.get("connectedParticipants"), 'id'));
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

		if(this.model.isLive()) {
			this.$el.addClass("live");

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

			this.ui.attend.find(".text").text("SIGN UP");
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
		this.$el.addClass("hangout-connected");

		// trying to simply not do the individual picture display to see if this helps.
		// (it does mostly, but there's still some slowness)
		this.ui.hangoutUsers.empty();

		var fragment = document.createDocumentFragment();

		_.each(this.model.get("connectedParticipants"), _.bind(function(udata) {
			// try looking up the user view from the main user list.
			var userView;
			if(udata.id in userViewCache) {
				userView = userViewCache[udata.id];
			} else {
                // vivify the user into a model when passing it in.  Note that
                // any events bound on the `users` collection of connected
                // participants won't work here.  When users join a session
                // without being connected to the `events` page, they won't appear
                // in that collection anyway.
				userView = new UserView({model:new models.User(udata)});
				userViewCache[udata.id] = userView;
			}

			fragment.appendChild(userView.render().el.cloneNode(true));
		}, this));


		this.ui.hangoutUsers.append(fragment);

		for(var i=0; i<10-numAttendees; i++) {
			this.ui.hangoutUsers.append($("<li class='empty'></li>"))
			// fragment.appendChild($("<li class='empty'></li>"));
		}


		this.ui.hangoutUsers.show();
		this.ui.hangoutOffline.hide();

		this.ui.attend.find(".icon-lock").hide();
		if(!curEvent.sessionsOpen() || numAttendees == this.model.MAX_ATTENDEES) {
			this.ui.attend.find(".icon-lock").show();

			this.ui.attend.attr("disabled", true);
			this.ui.attend.addClass("disabled");

			if(numAttendees==this.model.MAX_ATTENDEES) {
				this.ui.attend.find(".text").text("JOIN (full)");
			}
		} else {
			this.ui.attend.removeAttr("disabled");
			this.ui.attend.removeClass("disabled");
		}
	},

	destroy: function() {
		this.model.destroy();
	},

	attend: function() {
		// if the event currently has closed sessions, ignore
		// clicks on the join button.
		if(!curEvent.sessionsOpen()) {
			return;
		}

		if(this.model.isLive()) {
			// if the event has started, button presses should attempt to join
			// the hangout.
			var url = "/session/" + this.model.get("session-key");
			window.open(url);
		}
	},

	start: function() {
        //TODO: Server isn't listening for this..
		sock.send(JSON.stringify({
            type:"start", args: {id: this.model.id, roomid: curEvent.getRoomId()}
        }));
	},

	"delete": function() {
		sock.send(JSON.stringify({
            type:"delete-session", args: {id: this.model.id, roomId: curEvent.getRoomId()}
        }));
	}
});

// The list view contains all the individual session views. We don't
// manually make the session views - all that is handled by the 
// marionette CollectionView logic. Our primary issue in this class
// is to deal with pagination and its associated rendering issues.

var SessionListView = Backbone.Marionette.CompositeView.extend({
	template: "#session-list-template",
	itemView: SessionView,
	itemViewContainer: '#session-list-container',
	id: "session-list",

	initialize: function(args) {
		Backbone.Marionette.CollectionView.prototype.initialize.call(this, args);
	},

	onRender: function() {
		if(this.collection.length==0) {
			this.$el.find(".empty-notice").removeClass("hide");
		} else {
			this.$el.find(".empty-notice").addClass("hide");
		}
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

		this.listenTo(this.model, 'change:isBlurred', this.render, this);
	},	

	click: function() {
		console.log("user clicked: " + this.model.get("displayName"));
	},

	onRender: function() {
		// add in the tooltip attributes	
		if(this.model.isAdminOf(curEvent)) {
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
			this.$el.find("img, i").attr("data-container", "body");
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
		'click #remove-embed':'removeEmbed',
		'click #disconnected-modal a':'closeDisconnected',
		'click #create-session':'createSession',
        'change [name=session_type]': 'changeSessionType'
	},
    extractYoutubeId: function(val) {
        // From http://stackoverflow.com/a/6904504 , covering any of the 15
        // or so different variations on youtube URLs.
        // Allow blank values, so that we can clear the embed with them.
        if (val == "") {
            return "";
        }
        var ytid;
        if (/^[-A-Za-z0-9_]{11}$/.test(val)) {
            ytid = val;
        } else {
            var re = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/i;
            var match = re.exec(val);
            if (match) {
                ytid = match[1];
            } else {
                ytid = null;
            }
        }
        return ytid;

    },
	setEmbed: function() {
        var newId = this.extractYoutubeId($("#embed_youtube_id").val());
		if(_.isNull(newId)) {
			this.$("#embed-modal p.text-warning").show();
			this.$("#embed-modal .control-group").addClass("error");
		} else {
			this.$("#embed-modal p.text-warning").hide();
			this.$("#embed-modal .control-group").removeClass("error");
			var message = {type:"embed", args: {ytId:newId, roomId: curEvent.getRoomId()}};
			sock.send(JSON.stringify(message));
		}
	},
	removeEmbed: function() {
		// just send an empty message, and clear the field
		$("#embed_youtubue_id").val("");
        this.setEmbed();
	},
    changeSessionType: function() {
        var val = this.$("[name='session_type']:checked").val();
        switch (val) {
            case "simple":
                this.$(".youtube-url, .webpage-url").hide();
                break;
            case "video":
                this.$(".youtube-url").show();
                this.$(".webpage-url").hide();
                break;
            case "webpage":
                this.$(".webpage-url").show();
                this.$(".youtube-url").hide();
                break;
        };
    },
	createSession: function(event) {
        event.preventDefault();
        var scope = $("#create-session-modal");
		var title = $("#session_name", scope).val();
        var type = $("[name='session_type']:checked", scope).val();
        var activities = [];
        switch (type) {
            case "simple":
                activities.push({type: "about", autoHide: true});
                break;
            case "video":
                var ytid = this.extractYoutubeId($("#session_youtube_id", scope).val());
                if (ytid == "" || _.isNull(ytid)) {
                    $(".yt-error", scope).show();
                    $("#session_youtube_id", scope).parent().addClass("error");
                    return;
                } else {
                    activities.push({type: "video", video: {provider: "youtube", id: ytid}});
                }
                break;
            case "webpage":
                var url = this.$("#session_webpage").val();
                if (!/^https:\/\//.test(url)) {
                    $(".url-error", scope).show();
                    $("#session_webpage", scope).parent().addClass("error");
                    return;
                } else {
                    activities.push({type: "webpage", url: url});
                }
                break;
        }

		sock.send(JSON.stringify({
            type:"create-session",
            args: {
                title: title,
                description:"",
                activities: activities,
                roomId: curEvent.getRoomId()
            }
        }));
		$("input[type=text]", scope).val("");
        $(".yt-error, .url-error", scope).hide();
        $(".error", scope).removeClass(".error")
		scope.modal('hide');
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
		'click #open-sessions':'openSessions',
		'click #close-sessions':'closeSessions'
	},

	openSessions: function() {
		sock.send(JSON.stringify({type:"open-sessions", args:{roomId: curEvent.getRoomId()}}));
	},

	closeSessions: function() {
		sock.send(JSON.stringify({type:"close-sessions", args:{roomId: curEvent.getRoomId()}}));
	},

	showEmbedModal: function() {
        var ytId = curEvent.get("youtubeEmbed");
        if (ytId) {
            var url = "https://www.youtube.com/watch?v=" + ytId;
            $("#embed_youtube_id").val(url);
            $("#current-yt-url").html("Current: <a target='_blank' href='" + url + "'>" + url + "</a>");
            $("#remove-embed").show();
        } else {
            $("#embed_youtube_id").val("");
            $("#current-yt-url").html("");
            $("#remove-embed").hide();
        }
        $("#embed-modal").modal('show');
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

	initialize: function() {
		this.listenTo(this.collection, 'add remove', function() {
			// going to manually update the current user counter because
			// doing it during render doesn't seem to work. There's some 
			// voodoo in how marionette decides how much of the view to
			// re-render on events, and it seems to exclude the piece out-
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

			this.$el.find(".header .contents").text(this.collection.length);
		}, this);
	},

	serializeData: function() {
		var data = {};

		data = this.collection.toJSON();

		data["numUsers"] = this.collection.length;

		console.log("running user list serialize data");
		return data;
	},

	update: function() {
		console.log("rendering UserListView");
		this.render();
	}
});

// Manages chat message display. The layout piece sets up the differnt chat zones:
// the area where we show messages, the space where we put users, and the space
// where chat messages are entered. 
var ChatLayout = Backbone.Marionette.Layout.extend({
	template: '#chat-layout',
	id: 'chat',

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
	}
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

		if(msg.length>0) {
			sock.send(JSON.stringify({
                type:"chat", args: {text: msg, roomId: curEvent.getRoomId()}
            }));
			this.ui.chatInput.val("");
		}

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
    tagName: 'li',

	initialize: function() {
		this.model.set("text", this.linkify(this.model.get("text")));
	},

	// Finds and replaces valid urls with links to that url. Client-side only
	// of course; all messages are sanitized on the server for malicious content.
	linkify: function(msg) {
		var replacedText, replacePattern1, replacePattern2, replacePattern3, replacePattern4;

    	//URLs starting with http://, https://, or ftp://
     	replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
     	replacedText = msg.replace(replacePattern1, "<a href='$1' target='_blank'>$1</a>");

     	//URLs starting with "www." (without // before it, or it'd re-link the ones done above).
     	replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
     	replacedText = replacedText.replace(replacePattern2, "$1<a href='http://$2' target='_blank'>$2</a>");

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

		if(this.model.get("past")) {
			this.$el.addClass("past");
		}
	}
});

// This view contains all the ChatMessageViews and handles scrolling for them.

var ChatView = Marionette.CompositeView.extend({
	template: '#chat-template',
	itemView: ChatMessageView,
	itemViewContainer: "#chat-list-container",
	id: "chat-container",

    onBeforeItemAdded: function() {
        var limit = Math.max(this.el.scrollHeight - this.$el.height() - 10, 0);
        this._isScrolled = this.$el.scrollTop() < limit;
        return null;
    },
    onAfterItemAdded: function() {
        var latest = this.collection.at(this.collection.length - 1);
        // Scroll down if we haven't moved our scroll bar, or the last message
        // was from ourselves.
        if (!this._isScrolled || latest.get("user").id == USER_ID) {
            this.$el.scrollTop(this.el.scrollHeight);
        }
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
	}
});

// Manages the display of embedded videos on the upper left corner.
var VideoEmbedView = Marionette.ItemView.extend({
	template: '#video-embed-template',
	id: 'video-embed',

	player: null,

	initialize: function() {
		this.listenTo(this.model, "change:youtubeEmbed", function(model, youtubeEmbed) {
            if (!youtubeEmbed) {
                this.$el.hide();
            } else {
                this.$el.show();
                this.yt.setVideoId(this.model.get("youtubeEmbed"));
            }
		}, this);
	},
	onRender: function() {
        this.yt = new YoutubeVideo({
            ytID: this.model.get("youtubeEmbed"),
            showGroupControls: IS_ADMIN
        });
        this.yt.on("control-video", function(args) {
            _.extend(args, {roomId: curEvent.getRoomId()});
            sock.send(JSON.stringify({type: "control-video", args: args}));
        });
        this.yt.on("video-settings", _.bind(function(yt) {
            this.trigger("show-embed-modal");
        }, this));

        this.$(".player").html(this.yt.el);
		if(!this.model.get("youtubeEmbed")) {
			this.$el.hide();
		} else {
			this.$el.show();
            this.yt.render();
			//this.$el.draggable(); // wat
		}
	},
    control: function(args) {
        this.yt.receiveControl(args);
    }
});

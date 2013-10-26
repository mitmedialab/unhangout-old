// app.js
//
// This is the main hub of the client-side application. This never runs server-side.
//	
// It has two primary jobs:
//	1. configure the main application object for the client (this is a Marionette-style Application)
//	2. connect to the sever and manage the flow of messages
// 

var sock;

var curEvent, users, messages;

var app;

var curSession = null;

// handle IE not having console.log
if (typeof console === "undefined" || typeof console.log === "undefined") {
     console = {};
     console.log = function() {};
}



$(document).ready(function() {
	if($("#main").length!=1) {
		console.log("Code running on a page that does not have an #app div.");
		return;
	}

	console.log("Starting app!");

	// The constants used heavily in this block (eg EVENT_ATTRS, SINGLE_SESSION_RSVP, USER_ID)
	// come from the event.ejs file. They are the way that the server communicates the initial 
	// state of the event to the client - in a big JSON blob. Subsequent updates all happen
	// over the sockJS channel, but the initial state is embedded in these constants.
	curEvent = new models.ClientEvent(EVENT_ATTRS);
	
	users = new models.UserList(EVENT_ATTRS.connectedUsers);

	// add in some fake users for testing user list display
	// users.add(new models.User({displayName:"test1", picture:""}));
	// users.add(new models.User({displayName:"test2", picture:""}));
	// users.add(new models.User({displayName:"test3", picture:""}));
	// users.add(new models.User({displayName:"test4", picture:""}));
	// users.add(new models.User({displayName:"test5", picture:""}));
	// users.add(new models.User({displayName:"test6", picture:""}));
	// users.add(new models.User({displayName:"test7", picture:""}));
	// users.add(new models.User({displayName:"test8", picture:""}));
	// users.add(new models.User({displayName:"test9", picture:""}));
	// users.add(new models.User({displayName:"test10", picture:""}));
	// users.add(new models.User({displayName:"test11", picture:""}));
	// users.add(new models.User({displayName:"test12", picture:""}));
	// users.add(new models.User({displayName:"test13", picture:""}));
	// users.add(new models.User({displayName:"test14", picture:""}));
	// users.add(new models.User({displayName:"test15", picture:""}));
	// users.add(new models.User({displayName:"test16", picture:""}));
	// users.add(new models.User({displayName:"test17", picture:""}));
	// users.add(new models.User({displayName:"test18", picture:""}));
	// users.add(new models.User({displayName:"test19", picture:""}));
	// users.add(new models.User({displayName:"test20", picture:""}));
	// users.add(new models.User({displayName:"test21", picture:""}));
	// users.add(new models.User({displayName:"test22", picture:""}));
	// users.add(new models.User({displayName:"test23", picture:""}));
	// users.add(new models.User({displayName:"test24", picture:""}));
	// users.add(new models.User({displayName:"test25", picture:""}));
	// users.add(new models.User({displayName:"test26", picture:""}));
	// users.add(new models.User({displayName:"test27", picture:""}));
	// users.add(new models.User({displayName:"test28", picture:""}));
	// users.add(new models.User({displayName:"test29", picture:""}));
	// users.add(new models.User({displayName:"test30", picture:""}));

	
	curEvent.get("sessions").add(EVENT_ATTRS.sessions);
	
	messages = new models.ChatMessageList();
	
	console.log("Inflated models.");

	// documentation for Marionette applications can be found here:
	// https://github.com/marionettejs/backbone.marionette/blob/master/docs/marionette.application.md
	app = new Backbone.Marionette.Application();
	

	// the notion of regions comes from Marionette. 
	// https://github.com/marionettejs/backbone.marionette/blob/master/docs/marionette.region.md
	// 
	// Basically, they give us a way to create containers in the application, that different
	// views are added and removed from. It handles various event cleanup work on add/remove.
	// In this app, we don't often swap stuff in and out. It's primarily just a useful 
	// organizational abstraction.
	app.addRegions({
		right: '#main-right',
		main: '#main-left',
		topLeft: '#top-left',
		global: '#global',
		dialogs: '#dialogs',
		admin: '#admin-region',
		bar:'#bar',
		top:'#top'
	});
	
	// This is code that runs when the application initializes. 
	app.addInitializer(function(options) {
		
		// include the youtube JS api per docs:
	    // https://developers.google.com/youtube/iframe_api_reference
	    var tag = document.createElement('script');
	    tag.src = "//www.youtube.com/iframe_api";
	    var firstScriptTag = document.getElementsByTagName('script')[0];
	    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

	    window.onYouTubeIframeAPIReady = _.bind(function(playerId) {
			this.vent.trigger("youtube-ready");
	    }, this);
		
		// Pagination is a bit of a hairy situation. We're using a third party library
		// to provide most of the pagination support:
		// https://github.com/backbone-paginator/backbone.paginator
		// The paginated list basically maintains an underlying set of all sessions,
		// plus a sliding view of the current "page" of sessions. You can use
		// the object like any other backbone collection, and it returns only the current
		// page, so it's pretty transparent.
	    // this.paginatedSessions = new models.PaginatedSessionList(curEvent.get("sessions").models);

	    // I'm not sure why callign setsort is the right way to trigger sorts (sort of thought
	    // it would set the comparator) but it does seem to behave like we want it to.
	    // this.paginatedSessions.on("add", _.bind(function() {
		   //  this.paginatedSessions.setSort("title", "asc");
	    // }, this));

	    // the pagination system sort of assumes that it's going to be loading pages
	    // over HTTP from the server. Using it in this client-side way causes some 
	    // issues for it. One of them is that we have to manually tell it to set itself up,
	    // rather than letting it lazily load its contents on demand from an HTTP
	    // endpoint.
	    // this.paginatedSessions.bootstrap();

	    // create all the basic views
		this.sessionListView = new SessionListView({collection: curEvent.get("sessions")});
		this.chatView = new ChatLayout({messages:messages, users:users});
		this.youtubeEmbedView = new VideoEmbedView({model:curEvent});
		this.dialogView = new DialogView();

		this.aboutView = new AboutEventView({model:curEvent});

		// present the views in their respective regions
		this.right.show(this.chatView);
		this.main.show(this.sessionListView);
		this.dialogs.show(this.dialogView);
		this.top.show(this.aboutView);

		// this is a little unorthodox, but not sure how else
		// to do it.
		$(this.bar.el).hide();
		
		// obviously this is not secure, but any admin requests are re-authenticated on
		// the server. Showing the admin UI is harmless if a non-admin messes with it.
		if(IS_ADMIN) {
			this.adminButtonView = new AdminButtonView();
			this.admin.show(this.adminButtonView);
		}
				
		console.log("Initialized app.");

		$("#admin-page-for-event").attr("href", "/admin/event/" + curEvent.id);

		// This section sets up the blur/focus tracking. This serves two purposes. The first
		// is to represent users differently in the presence gutter as well as in the
		// session list, depending on whether or not they have the lobby window focused
		//
		// We also use this to decide whether or not to show new messages coming in
		// by changing the tab title.

		if(!curEvent.get("blurDisabled")) {
			var startingTitle = window.document.title;
			var isAlreadyBlurred; 
			$(window).blur(function() {
				if(isAlreadyBlurred)
					return ;

				isIntervalRunning = true ;
				windowBlurred = true ;
				messageShown = true ;

				var message = {type:"blur", args:{id:USER_ID}};
				sock.send(JSON.stringify(message));	

				isAlreadyBlurred = true; 
			})

			$(window).focus(function() {
				isIntervalRunning = false;
				windowBlurred = false;
				messageShown = false ;
				clearInterval(interval);
				window.document.title = startingTitle;

				var message = {type:"focus", args:{id:USER_ID}};
				sock.send(JSON.stringify(message));	

				isAlreadyBlurred = false;
			})
		}


	});

	// toggles the tab title to show new messages, but only if the window
	// is blurred (as detected above)
	app.showFlashTitle = function () {
		if(isIntervalRunning && !messageShown) {
			if(window.document.title == 'Unhangout')
				window.document.title = 'New Message ...';
			else
				window.document.title = 'Unhangout';

			interval = window.setTimeout(app.showFlashTitle , 1000);
		}
	};
	
	var interval = 0;
	var messageShown = false ;
	var windowBlurred = false ;
	var isIntervalRunning = false;

	// All these app.vent calls are setting up app-wide event handling. The app
	// can trigger these events in any manner it desires. We use this to abstract
	// the logic about where the events might come from, because in some situations
	// they're triggered by users, sometimes by the arrival of remove messages, 
	// sometimes as side effects of other actions. 
	app.vent.on("new-chat-message", _.bind(function() {
		if(windowBlurred)
			messageShown = false;
		else 
			messageShown = true;

		if(!messageShown && isIntervalRunning && windowBlurred)
			interval = window.setTimeout(this.showFlashTitle, 1000);

	}, app));

	var videoShown = false;
	var aboutShown = false;

	// this event handles the show-hide behavior of the video embed
	// in the upper left corner of the UI. There are lots of finnicky details here 
	// to handle the spacing properly.
	app.vent.on("video-nav", _.bind(function() {
		console.log("handling video-nav event");

		// regardless of whether there's a current embed, hide the video if
		// it's currently showon.	
		if(videoShown) {
			this.topLeft.$el.css("z-index", -10);
			this.topLeft.$el.addClass("hide");
			this.topLeft.reset();
			videoShown = false;

			this.main.$el.css("top", 0);
			$("#video-nav").removeClass("active");
		} else if(curEvent.hasEmbed()) {
			// we have to make sure the current event actually has an embed to show.
			// If we're in this branch it does. Otherwise, we ignore the click.

			$(".nav .active").removeClass("active");
	
			if(!videoShown) {
				this.topLeft.show(this.youtubeEmbedView);
				videoShown = true;
				this.topLeft.$el.removeClass("hide");

				var mainHeight = this.youtubeEmbedView.$el.outerHeight()-5;

				if(this.main.$el.hasClass("bar")) {
					mainHeight += 40;
				}

				this.main.$el.css("top", mainHeight);
				this.topLeft.$el.css("z-index", 50);
				$("#video-nav").addClass("active");
			}
		} else {
			console.log("Ignoring video click; no video available.");
		}			

	}, app));
	
	app.vent.on("about-nav", _.bind(function() {
		console.log("handling about-nav event");

		$(".updated").addClass("hide");
		if(aboutShown) {
			if(!curEvent.isLive()) {
				// don't let people dismiss the about screen if the event isn't live.
				return;
			}

			this.top.$el.animate({"top":(-1*this.top.$el.outerHeight()-15)});

			aboutShown = false;
			$("#about-nav").removeClass("active");
		} else {
			this.top.$el.animate({"top":0});
			aboutShown = true;

			$("#about-nav").addClass("active");
		}

	}, app));

	// We have to wait for the youtube api to load for us to embed the video. This
	// will trigger more or less on page load, so as a user you don't really see
	// any delay. But we do need to wait.
	app.vent.on("youtube-ready", _.bind(function() {
		console.log("YOUTUBE READY");

		if(curEvent.hasEmbed()) {
			app.vent.trigger("video-nav");
		}
	}, app));

	app.vent.on("video-live", _.bind(function() {
		$("#video-nav .label").removeClass("hide");
	}, app));
	
	app.vent.on("video-off", _.bind(function() {
		$("#video-nav .label").addClass("hide");
	}, app));

	// The 'bar' in this case is the "Your session is now live!" bar that appears
	// under the nav bar when the session you RSVP'd for is currently running.
	app.vent.on("show-bar", _.bind(function(sessionKey) {

		this.bar.show(new SessionLiveView());
		$(this.bar.el).show();

		$("#top-left, #main-right, #main-left").addClass("bar");

		// set the hangout link.
		this.bar.$el.find("a").attr("href", "/session/" + sessionKey);

		// 30 minutes later hide the bar(?)
		setTimeout(function() {
			app.vent.trigger("hide-bar");
		}, 60*1000*30);
	}, app));

	app.vent.on("hide-bar", _.bind(function() {
		this.bar.close();
		this.bar.$el.hide();

		$("#top-left, #main-right, #main-left").removeClass("bar");

		// we need to do a special check for main-left, which has custom
		// style adjustement on it.  
		if(videoShown) {
			this.main.$el.css("top", this.youtubeEmbedView.$el.outerHeight()-5);
		} else {
			this.main.$el.css("top", "");
		}

	}, app));

	// This only really come into play in the SINGLE_SESSION_RSVP case. Manages
	// the unattend/re-attend flow.
	var queuedAttend = false;
	app.vent.on("attend", _.bind(function(sessionId) {
		console.log("VENT ATTEND: " + sessionId);
		// we have to manage attend logic here in the single_session_rsvp case so
		// we can send unattend messages first, and then attend messages.

		// if they're the same, just ignore it.
		if(curSession && curSession!=sessionId) {

			queuedAttend = function() {
				var message = {type:"attend", args:{id:sessionId}};
				sock.send(JSON.stringify(message));				
			}

			var message = {type:"unattend", args:{id:curSession}};
			sock.send(JSON.stringify(message));
		} else if(!curSession) {
			var message = {type:"attend", args:{id:sessionId}};
			sock.send(JSON.stringify(message));				
		}
	}));

	app.start();

	// if the user joining has a curSession (ie a session they have RSVP'd to)
	// check and see if it's live. If it is, show the bar.
	// (Not sure how this will work in the non SINGLE_SESSION_RSVP mode, because
	//  you can RSVP to as many sessions as you like. Hmm. TODO.)
	if(curSession) {
		var curSessionObj = curEvent.get("sessions").get(curSession);

		if(curSessionObj.isLive()) {
			app.vent.trigger("show-bar", curSessionObj.get("session-key"));
		} 
	}

	if(curEvent.hasEmbed()) {
		app.vent.trigger("video-live");
	}

	// if the event isn't live yet, force the about page to show.
	if(!curEvent.isLive()) {
		app.vent.trigger("about-nav");
	} else {
		app.top.$el.animate({"top":(-1*app.top.$el.outerHeight() - 200)});
	}

	// Handles clicks on the nav bar links.
	$("#video-nav, #about-nav").click(function() {
		app.vent.trigger($(this).attr("id"));
	});
	
	console.log("Setup regions.");

	if(!_.isNull(curEvent.get("welcomeMessage"))) {
		// if there is a welcome message, put it in chat.
		messages.add(new models.ChatMessage({text:curEvent.get("welcomeMessage")}));
	}

	//------------------------------------------------------------------------//
	//																		  //
	//								NETWORKING								  //
	//																		  //
	//------------------------------------------------------------------------//
	// 
	// From here down, we're mostly concerned with managing networking and 
	// communication. 
	//
	// First up, create the SockJS object.
	sock = new SockJS(document.location.protocol + "//" + document.location.hostname + ":" + document.location.port + "/sock");

	// Register a bunch of listeners on the major events it will fire.
	sock.onopen = function() {		
		// on connect, send the auth message.
		var AUTH = {type:"auth", args:{key:SOCK_KEY, id:USER_ID}};
		
		sock.send(JSON.stringify(AUTH));
	};

	// This is the big one - handles every incoming message. 
	sock.onmessage = function(message) {

		// console.log(message);

		// messages come across the wire as raw strings in the data field.
		// parse them into a proper object here.
		var msg = JSON.parse(message.data);
		
		if(msg.type.indexOf("-err")!=-1) {
			console.log("Got an error from the server!");
		}
		
		// All messages have a type field. 
		switch(msg.type) {			
			// join an EVENT
			case "join":
				console.log("join: " + JSON.stringify(msg.args));
				users.add(new models.User(msg.args.user));
				break;
			
			// leave an EVENT
			case "leave":
				users.remove(users.get(msg.args.user.id));
				break;
				
			// chat message received
			case "chat":
				messages.add(new models.ChatMessage(msg.args));
				app.vent.trigger("new-chat-message");

				break;

			// a user has blurred the lobby window
			case "blur":
				var blurredUser = users.get(msg.args.id);
				blurredUser.setBlurred(true);
				break;

			// a user has focused the lobby window
			case "focus":
				var blurredUser = users.get(msg.args.id);
				blurredUser.setBlurred(false);
				break;
			
			// the embed for this event has been updated
			case "embed":
				var originalYoutubeId = curEvent.get("youtubeEmbed") || "";

				curEvent.setEmbed(msg.args.ytId);
				console.log("added yt embed id: " + JSON.stringify(msg.args));

				if(msg.args.ytId.length > 0) {
					// if it's a non-empty yt embed, show the live tag.
					app.vent.trigger("video-live");

					if(originalYoutubeId.length==0) {
						app.vent.trigger("video-nav");
					}
				} else {
					// if it's empty, hide the live tag.
					app.vent.trigger("video-off");
					app.vent.trigger("video-nav");
				}

				break;
			case "delete":
				var session = curEvent.get("sessions").get(msg.args.id);
				// app.paginatedSessions.remove(session);
				curEvent.removeSession(session);

				console.log("removing session: " + msg.args.id);
				break;

			// create a new session
			case "create-session":
				var session = new models.Session(msg.args);

				// this is sort of ugly to have to edit both. 
				// i'm not sure the former one is critical, but it is definitely
				// important that we add it to the special paginated sessions list.
				// after startup, we have to edit it directly.
				curEvent.get("sessions").add(session);
				// app.paginatedSessions.add(session);
				break;

			// update the list of a session's participants
			case "session-participants":
				var session = curEvent.get("sessions").get(msg.args.id);
				session.setConnectedParticipantIds(msg.args.participantIds);
				break;

			// mark a session as having its hangout connected and communicating
			case "session-hangout-connected":
				var session = curEvent.get("sessions").get(msg.args.id);
				session.set("hangoutConnected", true);
				break;

			// mark a session as disconnected
			case "session-hangout-disconnected":
				var session = curEvent.get("sessions").get(msg.args.id);
				session.setConnectedParticipantIds([]);
				session.set("hangoutConnected", false);
				break;

			case "open-sessions":
				curEvent.openSessions();
				app.sessionListView.render();		
				break;

			case "close-sessions":
				curEvent.closeSessions();
				app.sessionListView.render();		
				break;

			// sent in cases when the event's information has been updated.
			// includes the entire event JSON object as the server sees it.
			// copy it into curEvent.
			case "event-update":
				curEvent.set(msg.args);

				console.log("updated current event: " + JSON.stringify(msg.args));
				break;

			// *-ack message types are just acknowledgmeents from the server
			// of the receipt of a particular message type and that the
			// message was properly formatted and accepted. 
			//
			// mostly we don't do anything with these messages, but
			// in some situations we do react to them. They're used 
			// more for testing.
			case "auth-ack":
				sock.send(JSON.stringify({type:"join", args:{id:curEvent.id}}));
				break;
				
			case "embed-ack":
				$("#embed-modal").modal('hide');
				break;				
			case "join-ack":
				console.log("joined!");
				break;
			case "attend-ack":
				console.log("attend-ack");
				break;
		}
	};

	// handle losing the connection to the server. 
	// we want to put up a notice so the user knows that they've been disconnected (in
	// case they can do anything about it, like unpugged cable or wifi outage)
	// at the same time, we also want to attempt to reconnect if it was a server
	// outage and the server is restarting. So we occasionally ping the server
	// with an http request and when it responds successfully, we reload the page
	// which will trigger a full reconnection and state reset.
	sock.onclose = function() {
		$('#disconnected-modal').modal('show');
		messages.add(new models.ChatMessage({text:"You have been disconnected from the server. Please reload the page to reconnect!"}));
		
		var checkIfServerUp = function () {
		 	var ping = document.location;
			
		 	$.ajax({
 	 			url: ping,
 	 			cache: false,
 	 			async : false,

 	 			success: function(msg){
           		// reload window when ajax call is successful
           			window.location.reload();
       			},

       			error: function(msg) {
       			 	timeout = setTimeout(checkIfServerUp, 250);
       			}
		 	});
		};

		checkIfServerUp();
	};
});

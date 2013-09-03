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

	curEvent = new models.ClientEvent(EVENT_ATTRS);
	
	users = new models.PaginatedUserList(EVENT_ATTRS.connectedUsers);
	users.bootstrap();
	
	curEvent.get("sessions").add(EVENT_ATTRS.sessions);

	if(SINGLE_SESSION_RSVP) {
		curEvent.get("sessions").each(function(session) {
			if(session.isAttending(USER_ID)) {
				console.log("SETTING CUR SESSION: " + session.id);
				curSession = session.id;
			}
		})
	}

	$("#sessions-nav").find("a").text("Sessions (" + curEvent.get("sessions").length + ")");
	
	messages = new models.ChatMessageList();
	
	console.log("Inflated models.");

	app = new Backbone.Marionette.Application();
	
	app.addRegions({
		// top: '#top',
		right: '#main-right',
		main: '#main-left',
		top: '#top-left',
		global: '#global',
		dialogs: '#dialogs',
		admin: '#admin-region',
		bar:'#bar'
	});
	
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
		
	    this.paginatedSessions = new models.PaginatedSessionList(curEvent.get("sessions").models);
	    this.paginatedSessions.bootstrap();


		this.sessionListView = new SessionListView({collection: this.paginatedSessions});
		this.chatView = new ChatLayout({messages:messages, users:users});
		this.youtubeEmbedView = new VideoEmbedView({model:curEvent});
		this.dialogView = new DialogView();

		// this.top.show(this.sessionListView);
		this.right.show(this.chatView);
		this.main.show(this.sessionListView);
		this.dialogs.show(this.dialogView);

		// this is a little unorthodox, but not sure how else
		// to do it.
		$(this.bar.el).hide();
		
		if(IS_ADMIN) {
			this.adminButtonView = new AdminButtonView();
			this.admin.show(this.adminButtonView);
		}
				
		console.log("Initialized app.");

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
			window.document.title = 'Unhangout';

			var message = {type:"focus", args:{id:USER_ID}};
			sock.send(JSON.stringify(message));	

			isAlreadyBlurred = false;
		})

	});

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

	app.vent.on("new-chat-message", _.bind(function() {
		if(windowBlurred)
			messageShown = false ;
		else 
			messageShown = true ;

		if(!messageShown && isIntervalRunning && windowBlurred)
			interval = window.setTimeout(this.showFlashTitle, 1000);

	}, app));

	app.vent.on("sessions-nav", _.bind(function() {
		this.main.show(this.sessionListView);
	}, app));

	var videoShown = false;
	app.vent.on("video-nav", _.bind(function() {
		console.log("handling video-nav event");

		// regardless of whether there's a current embed, hide the video if
		// it's currently showon.	
		if(videoShown) {
			this.top.$el.css("z-index", -10);

			this.top.reset();
			videoShown = false;

			this.main.$el.css("top", 0);
			this.sessionListView.updateDisplay();
			$("#video-nav").removeClass("active");
		} else if(curEvent.hasEmbed()) {
			$(".nav .active").removeClass("active");
	
			if(!videoShown) {
				this.top.show(this.youtubeEmbedView);
				videoShown = true;

				var mainHeight = this.youtubeEmbedView.$el.outerHeight()-5;

				if(this.main.$el.hasClass("bar")) {
					mainHeight += 40;
				}

				this.main.$el.css("top", mainHeight);
				this.sessionListView.updateDisplay();
				this.top.$el.css("z-index", 50);
				$("#video-nav").addClass("active");
			}
		} else {
			console.log("Ignoring video click; no video available.");
		}			

	}, app));
	
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

	if(curSession) {
		var curSessionObj = curEvent.get("sessions").get(curSession);

		if(curSessionObj.isLive()) {
			app.vent.trigger("show-bar", curSessionObj.get("session-key"));
		} 
	}

	if(curEvent.hasEmbed()) {
		app.vent.trigger("video-live");
		// app.vent.trigger("video-nav");
	}

	$("#video-nav").click(function() {
		app.vent.trigger($(this).attr("id"));
	})
	
	console.log("Setup regions.");

	sock = new SockJS(document.location.protocol + "//" + document.location.hostname + ":" + document.location.port + "/sock");
	sock.onopen = function() {		
		var AUTH = {type:"auth", args:{key:SOCK_KEY, id:USER_ID}};
		
		sock.send(JSON.stringify(AUTH));
	};
	sock.onmessage = function(message) {
		console.log(message);
		var msg = JSON.parse(message.data);
		
		if(msg.type.indexOf("-err")!=-1) {
			console.log("Got an error from the server!");
		}
		
		switch(msg.type) {
			case "attend":
				curEvent.get("sessions").get(msg.args.id).addAttendee(msg.args.user);
				console.log("added attendee to a session");

				if(SINGLE_SESSION_RSVP && msg.args.user.id==USER_ID) {

					if(!_.isNull(curSession)) {
						var message = {type:"unattend", args:{id:curSession}};
						sock.send(JSON.stringify(message));				
					}

					curSession = msg.args.id;
				}
				break;
			
			case "first-attendee":
				curEvent.get("sessions").get(msg.args.id).setFirstAttendee(msg.args.user);
				console.log("set first attendee");
				break;
			
			case "unattend"	:
				curEvent.get("sessions").get(msg.args.id).removeAttendee(msg.args.user);
				console.log("removed attendee from a session");

				curSession = null;

				if(queuedAttend) {
					queuedAttend.call();
					queuedAttend = false;
				}

				break;
			
			case "join":
				console.log("join: " + JSON.stringify(msg.args));
				users.add(new models.User(msg.args.user));
				break;
			
			case "leave":
				users.remove(users.get(msg.args.user.id));
				break;
				
			case "chat":
				messages.add(new models.ChatMessage(msg.args));
				app.vent.trigger("new-chat-message");

				break;

			case "blur":
				var blurredUser = users.get(msg.args.id);
				blurredUser.setBlurred(true);

				break;

			case "focus":
				var blurredUser = users.get(msg.args.id);
				blurredUser.setBlurred(false);
				break;
			
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
				
			case "start":
				// this is a little wacky, but we want to give people who RSVP'd a chance to join first.
				// so we're going to do two things here: 
				// 1) if not rsvp, delay triggering start and setting the session key.
				// 2) if not rsvp, supress the dialog popup
				var session = curEvent.get("sessions").get(msg.args.id);
				
				var timeout = 0;
				
				if(!(session.isAttending(USER_ID))) {
					timeout = 60*1000;
				}				

				setTimeout(function() {
					session.set("session-key", msg.args.key);
					session.start();

					if(session.isattending(USER_ID)) {
						app.vent.trigger("show-bar", msg.args.key);
					}
				}, timeout);


				break;
			case "stop":
				var session = curEvent.get("sessions").get(msg.args.id);
				session.stop();

				if(session.id==curSession) {
					app.vent.trigger("hide-bar");
				}

				break;

			case "create-session":
				var session = new models.Session(msg.args);

				// this is sort of ugly to have to edit both. 
				// i'm not sure the former one is critical, but it is definitely
				// important that we add it to the special paginated sessions list.
				// after startup, we have to edit it directly.
				curEvent.get("sessions").add(session);
				app.paginatedSessions.add(session);
				break;

			case "session-participants":
				var session = curEvent.get("sessions").get(msg.args.id);
				session.setConnectedParticipantIds(msg.args.participantIds);

				for (var i=0; i< msg.args.participantIds.length; i++)
				{ 
					var user = users.get(msg.args.participantIds[i]);
					user.setIsInHangout(true);
				}

				break;

			case "session-hangout-connected":
				var session = curEvent.get("sessions").get(msg.args.id);
				session.set("hangoutConnected", true);
				break;

			case "session-hangout-disconnected":
				var session = curEvent.get("sessions").get(msg.args.id);
				var connectedParticipantList = session.get("connectedParticipantIds");

				for(var i =0; i< connectedParticipantList.length; i++) {
					var user = users.get(connectedParticipantList[i]);
					user.setIsInHangout(false);
				}

				session.set("hangoutConnected", false);

				break;

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

	sock.onclose = function() {
		$('#disconnected-modal').modal('show');
		messages.add(new models.ChatMessage({text:"You have been disconnected from the server. Please reload the page to reconnect!", user:{displayName:"SERVER"}}));
		
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

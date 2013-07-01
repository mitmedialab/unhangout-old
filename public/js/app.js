var sock;

var curEvent, users, messages;

var app;

$(document).ready(function() {
	if($("#main").length!=1) {
		console.log("Code running on a page that does not have an #app div.");
		return;
	}

	console.log("Starting app!");
	
	curEvent = new models.Event(EVENT_ATTRS);
	
	users = new models.UserList(EVENT_ATTRS.connectedUsers);
	
	curEvent.get("sessions").add(EVENT_ATTRS.sessions);
	
	messages = new models.ChatMessageList();
	
	console.log("Inflated models.");

	app = new Backbone.Marionette.Application();
	
	app.addRegions({
		top: '#top',
		right: '#main-right',
		main: '#main-left',		
	});
	
	app.addInitializer(function(options) {
		
		this.sessionListView = new SessionListView({collection: curEvent.get("sessions")});
		this.userListView = new UserListView({collection: users});
		this.chatView = new ChatView({collection:messages});
		
		this.top.show(this.sessionListView);
		this.right.show(this.userListView);
		this.main.show(this.chatView);
				
		// set up some extra methods for managing show/hide of top region.
		this.topShown = false;
		
		this.hideTop = _.bind(function() {
			this.top.$el.animate({
				top: -this.top.$el.outerHeight(),
			}, 500, "swing", _.bind(function() {
					this.topShown = false;
				}, this));
				
			this.main.$el.find("#chat-container").animate({
				top: 0
			}, 500, "swing")
				
		}, this);
		
		this.showTop = _.bind(function() {
			this.top.$el.animate({
				top: 0,
			}, 500, "swing", _.bind(function() {
				this.topShown = true;
			}, this));
			
			// hardcoded a bit, but we don't use main for anything else right now.
			this.main.$el.find("#chat-container").animate({
				top: this.top.$el.outerHeight()
			}, 500, "swing")
			
		}, this);
				
		// start sessions open, but triggering it properly.
		this.top.$el.css("top", -this.top.$el.outerHeight());
				
		console.log("Initialized app.");
	});

	app.vent.on("sessions-button", _.bind(function() {
		if(this.top.currentView==this.sessionListView && this.topShown) {
			// in this case, treat it as a dismissal.
			this.hideTop();
		} else {
			this.top.show(this.sessionListView);
			this.showTop();
		}
	}, app));
	
	app.start();
	app.vent.trigger("sessions-button");
	
	$("#sessions-nav").click(function() {
		console.log("CLICK");
		if($(this).hasClass("active")) {
			$(this).removeClass("active");
		} else {
			$(this).addClass("active");
		}
		
		app.vent.trigger("sessions-button");
	});
	
	console.log("Setup regions.");

	sock = new SockJS(document.location.protocol + "//" + document.location.hostname + ":" + document.location.port + "/sock");
	sock.onopen = function() {
		console.log('open');
		
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
				break;
			
			case "first-attendee":
				curEvent.get("sessions").get(msg.args.id).setFirstAttendee(msg.args.user);
				console.log("set first attendee");
				break;
			
			case "unattend"	:
				curEvent.get("sessions").get(msg.args.id).removeAttendee(msg.args.user);
				console.log("removed attendee from a session");
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
				break;
				
			case "start":
				curEvent.get("sessions").get(msg.args.id).start();
				break;
				
			case "set-hangout-url":
				curEvent.get("sessions").get(msg.args.id).set("hangout-url", msg.args.url);
				
				// now, if we're RSVP'd on this event, pop a dialog box.
				console.log("POP A DIALOG BOX HERE!")
				console.log(msg.args.id + "; " + msg.args.url);
				break;
				
			case "auth-ack":
				sock.send(JSON.stringify({type:"join", args:{id:curEvent.id}}));
				break;
				
			case "join-ack":
				console.log("joined!");
				break;
		}
	};

	sock.onclose = function() {
		console.log('close');
	};
});
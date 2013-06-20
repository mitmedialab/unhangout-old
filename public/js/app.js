var sock;

var curEvent, users, messages;

var app;

$(document).ready(function() {
	if($("#app").length!=1) {
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
		sessions: '#sessions',
		users: '#users',
		chat: '#chat',		
	});
	
	app.addInitializer(function(options) {
		
		this.sessionListView = new SessionListView({collection: curEvent.get("sessions")});
		this.userListView = new UserListView({collection: users});
		this.chatView = new ChatView({collection:messages});
		
		this.sessions.show(this.sessionListView);
		this.users.show(this.userListView);
		this.chat.show(this.chatView);
		
		console.log("Initialized app.");
	});
	
	app.start();

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
var models = require('../lib/server-models.js'),
	client_models = require('../public/js/models.js'),
	should = require('should');

models.logger = {warn: function() {}, info: function() {}, debug: function(){}};

describe("SERVEREVENT", function() {
	describe("#new", function() {
		it('should construct a default model', function() {
			var event = new models.ServerEvent();
			should.exist(event);
		});
	});
	
	describe("#isLive", function() {
		it('should return true if start date is before now and end date is after', function() {
			var event = new models.ServerEvent({start:new Date().getTime()-60, end:new Date().getTime()+60});
			event.isLive().should.equal(true);
		});
	});
	
	describe("#userConnected", function() {
		it("should add a connected user to its internal list", function() {
			var user = new models.ServerUser();
			var event = new models.ServerEvent();
			
			event.userConnected(user);
			event.get("connectedUsers").at(0).should.equal(user);
		});
		it("should return one user connected after one user connects", function() {
			var user = new models.ServerUser();
			var event = new models.ServerEvent();
			
			event.userConnected(user);
			event.numUsersConnected().should.equal(1);
		});
	});
	
	describe("#numUsersConnected", function() {
		it('should return 0 for a new event', function() {
			var event = new models.ServerEvent();
			event.numUsersConnected().should.equal(0);
		})
	});
});

describe("SESSION", function() {
	describe("#addAttendee", function() {
		it('should reject a second add, when max attendees is set to 1', function() {
			client_models.Session.prototype.MAX_ATTENDEES = 1;

			var session = new client_models.Session();
			session.addAttendee(new client_models.User({id:0}));

			var err = session.addAttendee(new client_models.User({id:1}));

			client_models.Session.prototype.MAX_ATTENDEES = 10;

			should.exist(err);
		});

		it('should reject a user who is already attending', function() {
			var session = new client_models.Session();

			var user = new client_models.User({id: 0});
			session.addAttendee(user);

			var err = session.addAttendee(user);
			should.exist(err);

		});
	});

	describe("#numAttendees", function() {
		it('should report 0 if no one has joined', function() {
			var session = new client_models.Session();
			
			var err = session.numAttendees();
			err.should.equal(0);
		});

		it('should report 1 when one person has joined', function() {
			var session = new client_models.Session();
			session.addAttendee(new client_models.User({id: 1}));

			var err = session.numAttendees();
			err.should.equal(1);
		});
	});

	describe("#removeAttendee", function() {
		it('should reject an attempt to remove someone who isn\'t present', 
			function() {
				var session = new client_models.Session();
				var user = new client_models.User({id: 0});

				var err = session.removeAttendee(user);
				should.exist(err);
			});

		it('should remove someone who has joined a session in the last', 
			function() {			
				var session = new client_models.Session();
				var user = new client_models.User({id: 0});
				
				session.addAttendee(user);
				session.removeAttendee(user);

			});
	});
});

describe("USER", function() {
	describe("#getShortDisplayName", function () {
		it('should work on simple first/last names', function() {
			var user = new client_models.User({displayName:"Drew Harry"});

			user.getShortDisplayName().should.equal("Drew H");
		});

		it("should work on hyphenated last names", function() {
			var user = new client_models.User({displayName:"Drew Harry-Chang"});

			user.getShortDisplayName().should.equal("Drew H-C");
		});

		it("should work with hyphenated middle names", function() {
			var user = new client_models.User({displayName:"Drew Erikson-Chikako Harry"});

			user.getShortDisplayName().should.equal("Drew E-C H");
		});
	});
});

describe("CHATMESSAGE", function() {
	describe("#new", function() {
		it('should escape html in chat messages', function() {
			var msg = new models.ServerChatMessage({text:"<h3>HEADER</h3>"});

			msg.get("text").indexOf("<h3>").should.equal(-1);
		});
	});
});
var models = require('../lib/server-models.js'),
	client_models = require('../public/js/models.js'),
	should = require('should');

describe("SERVEREVENT", function() {
	describe("#new", function() {
		it('should construct a default model', function() {
			var event = new models.ServerEvent();
			should.exist(event);
		});
	});
	
	describe("#isLive", function() {
		it('should return false before start is called on an event', function() {
			var event = new models.ServerEvent({title:"My great event", description:"This will be a great event."});

			event.isLive().should.be.false;
		});

		it('should return true after start is called on an event', function() {
			var event = new models.ServerEvent({title:"My great event", description:"This will be a great event."});

			event.start();
			event.isLive().should.be.true;
		});

		it('should return false after end and start are called on an event', function() {
			var event = new models.ServerEvent({title:"My great event", description:"This will be a great event."});

			event.start();
			event.stop();
			event.isLive().should.be.false;
		});

		it('should return true if an event is started, stopped, and started again', function() {
			var event = new models.ServerEvent({title:"My great event", description:"This will be a great event."});

			event.start();
			event.stop();
			event.start();
			event.isLive().should.be.true;
		});
	});

	describe("#start", function() {
		it('should start if stopped', function() {
			var event = new models.ServerEvent({title:"My great event", description:"This will be a great event."});

			var err = event.start();

			should.not.exist(err);
		});

		it('should return an error if started while already live', function() {
			var event = new models.ServerEvent({title:"My great event", description:"This will be a great event."});
			event.start();
			var err = event.start();
			err.should.be.instanceOf(Error);
		});
	});
	
	describe("#stop", function() {
		it('should stop if started already', function() {
			var event = new models.ServerEvent({title:"My great event", description:"This will be a great event."});

			event.start();
			var err = event.stop();

			should.not.exist(err);
		});

		it('should return an error if stopped while already stopped', function() {
			var event = new models.ServerEvent({title:"My great event", description:"This will be a great event."});

			event.start();
			event.stop();
			var err = event.stop();

			err.should.be.instanceOf(Error);
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

// describe("SESSION", function() {

// });

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

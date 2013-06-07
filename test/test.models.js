var models = require('../public/js/models.js'),
	should = require('should');

describe("EVENT", function() {
	describe("#new", function() {
		it('should construct a default model', function() {
			var event = new models.Event();
			should.exist(event);
		});
	});
	
	describe("#isLive", function() {
		it('should return true if start date is before now and end date is after', function() {
			var event = new models.Event({start:new Date().getTime()-60, end:new Date().getTime()+60});
			event.isLive().should.equal(true);
		});
	});
	
	describe("#userConnected", function() {
		it("should add a connected user to its internal list", function() {
			var user = new models.User();
			var event = new models.Event();
			
			event.userConnected(user);
			event.get("connectedUsers").at(0).should.equal(user);
		});
		it("should return one user connected after one user connects", function() {
			var user = new models.User();
			var event = new models.Event();
			
			event.userConnected(user);
			event.numUsersConnected().should.equal(1);
		});
	});
	
	describe("#numUsersConnected", function() {
		it('should return 0 for a new event', function() {
			var event = new models.Event();
			event.numUsersConnected().should.equal(0);
		})
	});
});
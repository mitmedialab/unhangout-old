var server = require('../lib/unhangout-server');

var s;

describe('unhangout server', function() {
	beforeEach(function() {
		s = new server.UnhangoutServer();
	});
	
	describe('setup', function() {
		it('#init should initialize', function() {
			s.init();
		});

		it('#start should start', function() {
			s.init();
			s.start();
		});
	});
})
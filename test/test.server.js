var server = require('../lib/unhangout-server');

var s;

describe('unhangout server', function() {
	beforeEach(function() {
		s = new server.UnhangoutServer();
		s.init({"transport":"file", "level":"debug"});
	});
	
	afterEach(function(done) {
		s.stop();
		s.on("stopped", function() {
			s.on("destroyed", done);
			s.destroy();
		})
	});
	
	
	describe('setup', function() {
		it('#start should start', function() {
			s.start();
		});
		
		it("#start should emit 'started' message when complete", function(done) {
			s.on("started", done);
			s.start();
		});
	});
	
})
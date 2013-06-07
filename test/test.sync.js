var models = require('../public/js/models.js'),
	winston = require('winston'),
	sync = require('../lib/redis-sync.js'),
	redis = require('redis').createClient();
	should = require('should');

var logger= new (winston.Logger)({
    transports: [
		new (winston.transports.File)(
			{
			filename: "test.log",
			timestamp: true
			})
    ],
    levels: winston.config.syslog.levels
});



describe('sync', function() {	
	it('should initialize properly', function() {
		sync.init(logger, redis);
	});
});
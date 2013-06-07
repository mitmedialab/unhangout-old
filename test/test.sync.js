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
	
	describe("#init", function() {
		it('should initialize properly', function() {
			sync.init(logger, redis);
		});
	})
	
	describe('#sync', function() {
		beforeEach(function(done) {
			redis.select(1, function(err, res) {
				redis.flushdb(function() {
					sync.init(logger, redis);
					logger.info("calling init");
					done();
				});
			});
		});

		it('should assign an id to an object that doesn\'t have one.', function(done) {
			var user = new models.Event();
			user.save(null, {success: function() {
				user.get("id").should.equal(1);
				done();
			}});
		});
		
		it('should write JSON to a key specified by the object\'s url.', function(done) {
			var user = new models.Event();
			user.save(null, {success: function() {
				redis.get(user.url(), function(err, res) {
					res.should.equal(JSON.stringify(user.toJSON()));
					done();
				});
			}});
		});
		
		
		describe('.read', function() {
			it('should fetch a collection properly');
			it('should update the contents of a collection');
			it('should remove an item from a collection');
		});
	});
});
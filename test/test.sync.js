var models = require('../public/js/models.js'),
	sync = require('../lib/redis-sync.js'),
	redis = require('redis').createClient(),
    logger = require('../lib/logging').getLogger(),
	should = require('should');

var event;


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
                    sync.setPersist(true);
					logger.info("calling init");
					done();
				});
			});
		});

		it('should assign an id to an object that doesn\'t have one.', function(done) {
			event = new models.Event();
			event.save(null, {success: function() {
				event.get("id").should.equal(1);
				done();
			}});
		});
		
		it('should write to a hash key specified by the object\'s url.', function(done) {
			event = new models.Event();
			event.save(null, {success: function() {
				redis.get(event.url(), function(err, res) {
					res.should.equal(JSON.stringify(event.toJSON()));
					done();
				});
			}});
		});
	});
});

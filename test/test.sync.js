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
		
		it('should write JSON to a key specified by the object\'s url.', function(done) {
			event = new models.Event();
			event.save(null, {success: function() {
				redis.get(event.url(), function(err, res) {
					res.should.equal(JSON.stringify(event.toJSON()));
					done();
				});
			}});
		});

		describe('.read (model) ', function() {
			beforeEach(function(done) {
				event = new models.Event();
				event.save(null, {success: function() {
					done()}});
			});
			
			it('should fetch a model properly', function(done) {
				var emptyEvent = new models.Event({id:1, title: "asdf"});
				
				emptyEvent.fetch({success: function(model, response, options) {
					model.get("title").should.equal(event.get("title"));
					done();
				}});
			});
			
			it('should update the contents of a collection');
			it('should remove an item from a collection');
		});
		
		
		describe('.read (collection) ', function() {
			it('should fetch a collection properly');
			it('should update the contents of a collection');
			it('should remove an item from a collection');
		});
	});
});
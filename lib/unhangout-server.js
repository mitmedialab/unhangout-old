var winston = require('winston'),
	_ = require('underscore')._,
	EventEmitter = require('events').EventEmitter,
	redis_lib = require('redis'),
	sync = require('./../lib/redis-sync.js'),
	express = require('express'),
	RedisStore = require('connect-redis')(express),
	http = require('http'),
	passport = require('passport'),
	GoogleStrategy = require('passport-google-oauth').OAuth2Strategy,
	sockjs_lib = require('sockjs');

var models = require('./../public/js/models.js');

var logger;

exports.UnhangoutServer = function() {

}

exports.UnhangoutServer.prototype = {
	options: null,
	running: false,
	express: null,
	http: null,
	sockjs: null,
	inited: false,
	redis: null,
	users: null,
	events: null,
	
	init: function(options) {
		if(_.isUndefined(options)) {
			options = {};
		}
		
		this.options = _.defaults(options, {"level":"debug", "transport":"console", "HOST":"localhost", "PORT":7777,
			"REDIS_HOST":"localhost", "REDIS_PORT":6379, "SESSION_SECRET":"fake secret", "REDIS_DB":0, "persist":true});
		var transports = [];
		switch(this.options.transport) {
			case "console":
				transports.push(new (winston.transports.Console)({
						timestamp: true,
						json: false,
						level: this.options.level
					}));
				break;
			case "file":
				transports.push(new (winston.transports.File)({
							filename: 'server.log',
							timestamp: true,
							json: false,
							level: this.options.level
						}));
				break;
		}
		
		logger = new (winston.Logger)({transports:transports, levels:winston.config.syslog.levels});
		
		if(this.options.transport=="console") logger.cli();

		if(!("GOOGLE_CLIENT_ID" in this.options)) {
			logger.error("Missing GOOGLE_CLIENT_ID in options.")
			this.emit("error", "Missing GOOGLE_CLIENT_ID in options.");
			return;
		}
		
		if(!("GOOGLE_CLIENT_SECRET" in this.options)) {
			logger.error("Missing GOOGLE_CLIENT_SECRET in options.")
			this.emit("error", "Missing GOOGLE_CLIENT_SECRET in options.");
			return;
		}
		
		// TODO is it bad for this to be the same as the session secret? leaving the same for now.
		models.USER_KEY_SALT = this.options.SESSION_SECRET;
		
		this.users = new models.UserList();
		this.events = new models.EventList();
		//----------------------------//
		// Making some sample events here. Ultimately, when we have a proper admin UI, this should get
		// removed.
		this.events.add(new models.Event({id:0, title:"Scratch Pedagodgy Unhangout", organizer: "MIT Media Lab & ConnectedLearning.tv",
										 description: "Come join us to talk about how to use Scratch in an educational environment. Aimed at educators, parents, and administrators interested in sharing best practices, learning from experts, and taking their Scratch curricula to the next level.",
										start: new Date().getTime(), end: new Date().getTime()+60*60*2*1000}));

		this.events.add(new models.Event({id:1, title:"Open Source Learning Unhangout", organizer: "MIT Media Lab & ConnectedLearning.tv",
										 description: "There are more online resources for education than ever, but how to make sense of them all? Do they have a role in a traditional classroom? For life long learners? Come share your favorite resources, discover new ones, and get inspired about how to bring open educational resources into your classroom.",
										start: new Date().getTime()+60*60*24*4*1000, end: new Date().getTime()+60*60*24*4*1000 + 60*60*2*1000}));
		
		//---------------------------//
		
		this.redis = redis_lib.createClient(parseInt(this.options.REDIS_PORT), this.options.REDIS_HOST);
		this.redis.on("connect", _.bind(function(err) {
			if(err) {
				logger.error("Error connecting to redis: " + err);
				this.emit("error", "Error connecting to redis: " + err, err);
				return;
			}
			
			this.inited = true;
			logger.info("UnhangoutServer initialized.");
			this.redis.select(this.options.REDIS_DB, _.bind(function(err, res) {
				if(err) this.emit("error", err);
				
				// setup redis sync
				sync.init(logger, this.redis);
				sync.setPersist(this.options.persist);
				
				this.initializeModelsFromRedis(_.bind(function(err) {
					if(err) {
						logger.err("Error loading models from redis: " + err);
					} else {
						logger.info("Loading " + this.users.length + " users from redis.");
						this.emit("inited");	
					}
				}, this));
			}, this));
		}, this));
	},
	
	start: function() {
		if(!this.inited) {
			logger.error("Attempted to start, but server is not initialized.");
			this.emit("error", "Attempted to start, but server is not initialized.");
			return;
		}
		
		
		
		logger.log("info", "Starting UnhangoutServer on %s:%d", this.options.HOST, this.options.PORT);
		
		this.express = express();
		this.http = http.createServer(this.express);
		this.sockjs = sockjs_lib.createServer({
			"log":function(severity, message) {
				logger.log("debug", severity + ": " + message);
			},
			"disconnect_delay": this.options.disconnect_delay
		});
		
		this.sockjs.on('connection', _.bind(function(conn) {
			
			logger.debug("USERS: " + JSON.stringify(this.users));
			
		    logger.info('connection' + conn);
		
			// flag the connection as unauthenticated until we get an authentication message.
			conn.authenticated = false;
		
		    conn.on('close', function() {
		        logger.info('close ' + conn);
		    });
		    conn.on('data', _.bind(function(string) {
				// TODO wrap this in error handling
				var message = JSON.parse(string);
				
				if(!("type" in message)) {
					logger.warn("Received message without 'type' key: " + string);
					return;
				}
				
				switch(message.type) {
					case "AUTH":
						// expecting: "id" and "key"
						if("id" in message && "key" in message) {
							var user = this.users.get(message.id);
							
							if(_.isUndefined(user)) {
								logger.warn("User presented unrecognized id: " + message.id);
								return;
							}
							
							if(user.validateSockKey(message.key)) {
								logger.info("AUTHENTICATED sock " + conn.id + " to user " + user.id);
							} else {
								logger.warn("Invalid key presented for user " + user.id);
							}
							
						} else {
							logger.warn("Missing 'id' or 'key' in AUTH message payload.");
							return;
						}
						break;
					default:
						logger.warn("Server does not handle '" + message.type + "' type events.");
						break;
				}
				
		    }, this));
		}, this));
		
		logger.info("sockjs server created");
		
		this.sockjs.installHandlers(this.http, {prefix:'/sock'});
		
		logger.info("\tsock thandlers installed");
		
		
		passport.use(new GoogleStrategy({
			clientID: this.options.GOOGLE_CLIENT_ID,
			clientSecret: this.options.GOOGLE_CLIENT_SECRET,
			callbackURL: "http://" + this.options.HOST + ":" + this.options.PORT + "/auth/google/callback"
		}, _.bind(function(accessToken, refreshToken, profile, done) {

			// Add this newly callback-ed user to our list of known users.
			delete profile["_raw"];
			
			var newUser = new models.User(profile);
			
			newUser.save();
			this.users.add(newUser);

			return done(null, profile);
		}, this)));
		
		passport.serializeUser(_.bind(function(user, done) {
			done(null, user.id);
		}, this));
		
		passport.deserializeUser(_.bind(function(id, done) {
			var user = this.users.get(id);
			if(_.isNull(user)) {
				logger.error("Tried to deserialize a user that did not exist; user:" + id);
				done(new Error('user/' + id + " does not exist."));
			} else {
				done(null, user);
			}
		}, this));
		
		var redisSessionStore = new RedisStore({client:this.redis});
		
		this.express.engine('.ejs', require('ejs').__express);
		this.express.set('views', __dirname + '/../views');
		this.express.set('view engine', 'html');
		
		this.express.use(express.cookieParser());
		this.express.use(express.bodyParser());
		this.express.use(express.session({ secret: this.options.SESSION_SECRET, store:redisSessionStore, cookie: {maxAge:1000*60*60*24*365}}));
		this.express.use(passport.initialize());
		this.express.use(passport.session());
		this.express.use("/public", express.static(__dirname + "/../public"));
		
		this.express.get("/", _.bind(function(req, res) {
			res.render('index.ejs', {user:req.user, events:this.events, _:_});
		}, this));
		
		// make sure they're authenticated before they join the event.
		this.express.get("/event/:id", ensureAuthenticated, _.bind(function(req, res) {
			var e = this.events.get(parseInt(req.params.id));
			if(_.isUndefined(e)) {
				logger.warn("Request for a non-existent event id: " + req.params.id);
				res.status(404);
				res.send();
				return;
			}
			
			res.render('event.ejs', {user:req.user, event:e, _:_});
		}, this));
		
		this.express.get('/login', function(req, res) {
			res.render('login', {user:req.user});
		});
		
		this.express.get("/auth/google", passport.authenticate('google', { scope: ['https://www.googleapis.com/auth/userinfo.profile',
		                                            'https://www.googleapis.com/auth/userinfo.email']}),
			function(req, res) {
				logger.warning("Auth request function called. This is unexpected! We expect this to get routed to google instead.");
			}
		);
		
		this.express.get("/auth/google/callback", passport.authenticate('google', {failureRedirect: '/login'}),
			function(req, res) {
				if("post-auth-path" in req.session) {
					res.redirect(req.session["post-auth-path"]);
					delete req.session["post-auth-path"];
				} else {
					res.redirect("/");
				}
			}
		);
		
		this.express.get("/logout", function(req, res) {
			req.logout();
			res.redirect("/");
		});
		
		this.http.listen(this.options.PORT);
		logger.info("http server listening");
		
		this.emit("started");
		this.running = true;
	},
	
	stop: function() {
		if(!this.running) {
			logger.warning("Tried to stop a server that was not running.");
			this.emit("error", "Tried to stop a server that was not running.");
			return;
		}
		
		logger.info("Stopping UnhangoutServer!");
		
		// TODO gracefully disconnect all users
		
		this.http.close();
		
		this.http.on("close", _.bind(function() {
			this.running = false;
			this.emit("stopped");
		}, this));
	},
	
	destroy: function() {
		this.express = null;
		this.sockjs = null;
		this.http = null;
		
		logger.info("destroyed");
		this.emit("destroyed");
	},
	
	initializeModelsFromRedis: function(callback) {
		// load models in from redis.
		// 1. users
		
		// get all the user keys, loop through the and grab all their pieces.
		this.redis.keys("user/*", _.bind(function(err, modelKeys) {
			if(modelKeys.length==0) {
				callback && callback(err);
				return;
			}
			
			this.redis.mget(modelKeys, _.bind(function(err, modelsJSON) {
				_.each(modelsJSON, _.bind(function(modelJSON) {
					
					var modelJSONObj = JSON.parse(modelJSON);
					
					// TODO look more closey at what comes back from google.
					// We seem to get 3 pieces:
					// A top level object with displayName, email, and id.
					// Then we get two more hashes: _raw and _json, which
					// both include the same as above, except they also have
					// a link to a profile page and the user image (both of 
					// which are valuable to us.) I'd like to just throw out
					// these extra fields and get the fields we want in the
					// main response, but I'm not sure how yet.
					
					// stopped doing this in lieu of throwing _raw out entirely
					// modelJSONObj["_raw"] = JSON.parse(modelJSONObj["_raw"]);
					
					var newUser = new models.User(modelJSONObj);
					// no need to save since we're pulling from the
					// database to begin with.
					this.users.add(newUser);
					callback && callback(err);
				}, this));
			}, this));
		}, this));
		
		// 2. events
		// 3. sessions
	},
}

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) { return next(); }
  req.session["post-auth-path"] = req.path;
  res.redirect('/auth/google');
}


// Mix in the node events structures so we have on/emit available on the server.
// This is helpful for testing and various other sorts of indirection.
_.extend(exports.UnhangoutServer.prototype, EventEmitter.prototype);
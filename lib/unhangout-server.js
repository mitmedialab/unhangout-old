var winston = require('winston'),
	_ = require('underscore')._,
	EventEmitter = require('events').EventEmitter,
	redis_lib = require('redis'),
	sync = require('./../lib/redis-sync.js'),
	async = require('async'),
	express = require('express'),
	RedisStore = require('connect-redis')(express),
	http = require('http'),
	passport = require('passport'),
	passportMock = require('./../lib/passport-mock.js'),
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
	
	unauthenticatedSockets: null,
	
	init: function(options) {
		if(_.isUndefined(options)) {
			options = {};
		}
		
		this.options = _.defaults(options, {"level":"debug", "transport":"console", "HOST":"localhost", "PORT":7777,
			"REDIS_HOST":"localhost", "REDIS_PORT":6379, "SESSION_SECRET":"fake secret", "REDIS_DB":0, "persist":true,
			"mock-auth":false});
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
		
		this.unauthenticatedSockets = {};
		
		this.users = new models.UserList();
		this.events = new models.EventList();
		//----------------------------//
				
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
				
				if(this.options['mock-auth']) {
					this.users.add(new models.User(passportMock.mockUser));
				} 
				
				this.initializeModelsFromRedis(_.bind(function(err) {
					if(err) {
						logger.err("Error loading models from redis: " + err);
					} else {
						logger.info("Loaded " + this.users.length + " users from redis.");
						logger.info("Loaded " + this.events.length + " events from redis.");
						
						var counter = 0;
						this.events.each(function(event) {
							counter += event.get("sessions").length;
						});
						
						logger.info("Loaded " + counter + " sessions from redis.");
						
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
			
			// put this connection in the unauthenticated list
			this.unauthenticatedSockets[conn.id] = conn;
		
		    conn.on('close', _.bind(function() {
				if(conn.authenticated) {
					conn.user.set("sock", null);
				} else {
					delete this.unauthenticatedSockets[conn.id];
				}
		    }, this));
		
		    conn.on('data', _.bind(function(string) {
				// TODO wrap this in error handling
				var message = JSON.parse(string);

				if(!("type" in message)) {
					logger.warn("Received message without 'type' key: " + string);
					return;
				}
				
				switch(message.type) {
					case "auth":
					
						// expecting: "id" and "key"
						if("id" in message.args && "key" in message.args) {
							
							var user = this.users.get(message.args.id);
							
							if(_.isUndefined(user)) {
								logger.warning("User presented unrecognized id: " + message.args.id);
								writeErr(conn, "auth");
								return;
							}
							
							if(user.validateSockKey(message.args.key)) {
								logger.info("AUTHENTICATED sock " + conn.id + " to user " + user.id);
								conn.authenticated = true;
								// TODO send a message to the client acknowledging.
								
								delete this.unauthenticatedSockets[conn.id];
								
								user.set("sock", conn);
								conn.user = user;
								
								writeAck(conn, "auth");
							} else {
								logger.warning("Invalid key presented for user " + user.id);
								writeErr(conn, "auth");
							}
							
						} else {
							logger.warning("Missing 'id' or 'key' in AUTH message payload.");
							writeErr(conn, "auth");
							return;
						}
						break;
					default:
						logger.warning("Server does not handle '" + message.type + "' type events.");
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
		
		if(this.options["mock-auth"]) {
			this.express.use(passportMock.initialize(passportMock.mockUser));
			logger.info("Using mock-authentication; all users will auth-authenticate as Drew Harry");
		} else {
			this.express.use(passport.initialize());
		}
		this.express.use(passport.session());
		this.express.use("/public", express.static(__dirname + "/../public"));
		
		this.express.get("/", _.bind(function(req, res) {
			res.render('index.ejs', {user:req.user, events:this.events, _:_});
		}, this));
		
		// make sure they're authenticated before they join the event.
		this.express.get("/event/:id", ensureAuthenticated, _.bind(function(req, res) {
			var e = this.events.get(parseInt(req.params.id));
			if(_.isUndefined(e)) {
				logger.warning("Request for a non-existent event id: " + req.params.id);
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
		
		// this little bit of cleverness is disconnecting all the unauthenticated sockets
		// in parallel, and then once they all return a "close" event, moving on with
		// the shutdown process. The dance through types here is:
		// 1. go from an Object that is socket.id -> socket to just a list of sockets (_.values)
		//		also, merge in all the sock objects from users
		// 2. convert each of those sockets into a function that disconnects that socket, and calls
		//		the callback function when it's successful
		// 3. put those resulting function references into a list of parallel functions to execute
		async.parallel(_.map(_.union(_.values(this.unauthenticatedSockets), this.users.pluck("sock")), function(socket) {
			
			// if the socket doesn't exist, just callback instantly
			if(_.isNull(socket) || _.isUndefined(socket)) {
				return function(callback) {
					callback();
				}
			};
			
			return function(callback) {
				socket.on("close", callback);
				socket.close()
			};
		}), _.bind(function(err, results) {
			// this executes only after we've disconnected all the unauthenticated sockets.
			this.http.close();

			this.http.on("close", _.bind(function() {
				this.running = false;
				this.emit("stopped");
				}, this));
			}, this));
	},
	
	destroy: function() {
		this.express = null;
		this.sockjs = null;
		this.http = null;
		
		logger.info("destroyed");
		this.emit("destroyed");
	},
	
	initializeModelsFromRedis: function(done) {
		// Okay, this looks scary but it's relatively simple.
		// Basically, the loaders set up methods that we call
		// with a simple JS object representing each of the
		// objects of that type in redis. It simply needs to 
		// construct matching objects. This drives the 
		// crazy async engine that follows. To add a new type,
		// just add a matching entry in loaders and follow
		// the format.
		
		var loaders = {
			"user/*":_.bind(function(callback, attrs, key) {
				var newUser = new models.User(attrs);
				// no need to save since we're pulling from the
				// database to begin with.
				this.users.add(newUser);
				callback();
			}, this),
			
			"event/?????":_.bind(function(callback, attrs, key) {
				var newEvent = new models.Event(attrs);
				this.events.add(newEvent);
				callback();
			}, this),
			
			"event/*/sessions/*":_.bind(function(callback, attrs, key) {
				var eventId = parseInt(key.split("/")[1]);

				var event = this.events.get(eventId);
				var newSession = new models.Session(attrs);
				event.addSession(newSession);
				
				callback();
			}, this)
		};
		
		// This mess is doing three things:
		// 1) figuring out all the key names of all the objects of this type in redis
		// 2) running mget to grab all those json strings at once
		// 3) calling the loader callbacks with parsed versions of those JSON strings
		//
		// It seems worse than it is because of annoying async/map/bind wrappers, but
		// that's just to get all the closures configured right.
		async.series(_.map(_.pairs(loaders), _.bind(function(loader) {
			return _.bind(function(callback) {
				logger.info("loading " + loader[0]);
				this.redis.keys(loader[0], _.bind(function(err, modelKeys) {
					if(modelKeys.length==0) {
						callback(err);
						return;
					}
					this.redis.mget(modelKeys, _.bind(function(err, modelsJSON) {
						async.parallel(_.map(modelsJSON, _.bind(function(modelJSON, index) {
							var key = modelKeys[index];
							return _.bind(function(callback) {
								var attrs = JSON.parse(modelJSON);
								loader[1](callback, attrs, key);
							}, this);
						}, this)), function(err, result) {
							callback();
						});
					}, this));
				}, this));
			}, this);
		}, this)), function(err, results) {
			logger.info("Done loading models.");
			done();
		});
	}
}

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) { return next(); }
  req.session["post-auth-path"] = req.path;
  res.redirect('/auth/google');
}


// Mix in the node events structures so we have on/emit available on the server.
// This is helpful for testing and various other sorts of indirection.
_.extend(exports.UnhangoutServer.prototype, EventEmitter.prototype);

// I really want these to be class methods on a socket, but I'll be damned if I can
// figure out how to do it.
function writeObj(conn, type, args) {
	conn.write(JSON.stringify({type:type, args:args}));
}

function writeErr(conn, msgType, errorMessage) {
	if(!_.isUndefined(errorMessage) && !_.isNull(errorMessage)) {
		conn.write(JSON.stringify({type:msgType+"-err", args:{message:errorMessage}}));
	} else {
		conn.write(JSON.stringify({type:msgType+"-err"}));
	}
}

function writeAck(conn, msgType) {
	conn.write(JSON.stringify({type:msgType+"-ack"}));
}

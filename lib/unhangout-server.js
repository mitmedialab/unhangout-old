var winston = require('winston'),
	_ = require('underscore')._,
	EventEmitter = require('events').EventEmitter,
	redis_lib = require('redis'),
	sync = require('./../lib/redis-sync.js'),
	async = require('async'),
	express = require('express'),
	RedisStore = require('connect-redis')(express),
	http = require('http'),
	https = require('https'),
	passport = require('passport'),
	passportMock = require('./../lib/passport-mock.js'),
	GoogleStrategy = require('passport-google-oauth').OAuth2Strategy,
	farming = require('./../lib/hangout-farming.js'),
	sockjs_lib = require('sockjs');

var models = require('./server-models.js'),
	client_models = require('../public/js/models.js');

var logger;
var mockAdmin;

// This is the primary class that represents the UnhangoutServer.
// I organize the server pieces into a class so we can more easily
// manage the lifecycle of the server in an object-oriented way.
// In particular, this makes testing much more tractable.
// The server has four main lifecycle methods:
//
//	1. init()		prepare the server for starting - connect to DB, load models, etc. does not bind to any ports or start handling requests
//	2. start()		start the http + sockjs serving cores
//	3. stop()		shut down the externally facing connections, close all existing client connections, etc. in theory, you should be able to call start() after stop() but I haven't tested that lately.
//	4. destroy()	dereference all the major class variables
//
// Each of these lifecycle methods emits an event when it completes, eg 'inited', 'started', 'stopped', 'destroyed'
//
//

// the constructor does basically nothing, since all substantive setup
// takes place in init() instead.
exports.UnhangoutServer = function() {

}

exports.UnhangoutServer.prototype = {
	options: null,			// passed in to init(), configuration options
	running: false,			// true if server is started
	inited: false,			// flag to check initialization state
	
	express: null,			// reference to the http express wrapper
	http: null,				// reference to the node http server base object
	sockjs: null,			// reference to the sockjs server
	redis: null,			// reference to redis connection
	
	permalinkSessions: null,

	users: null,			// backbone collection of known users (loaded on startup)
	events: null,			// backbone collection of known events (loaded on startup)
	
	unauthenticatedSockets: null,	// sockets currently in limbo; connected but unauthenticated
	
	logger: null,			// logger helper object
	
	init: function(options) {
		// the models package needs a reference to the current server object
		// for various activities, particularly sending messages to connected
		// clients.
		models.server = this;
		
		if(_.isUndefined(options)) {
			options = {};
		}
		
		// apply default options if they're not provided.
		// (otherwise, they will come from conf.json)
		this.options = _.defaults(options, {"level":"debug", "transport":"console", "HOST":"localhost", "PORT":7777,
			"REDIS_HOST":"localhost", "REDIS_PORT":6379, "SESSION_SECRET":"fake secret", "REDIS_DB":0, "persist":true,
			"mock-auth":false, "mock-auth-admin":false, "timeoutHttp":false});

		// this piece manages different logger transport options. Either it
		// outputs logging information to the console (good for development)
		// or to a file (good for production). This also manages logging level,
		// so you can switch between info and debug level logging if desired.
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
		
		logger = new (winston.Logger)({transports:transports});
		models.logger = logger;
		this.logger = logger;
		
		if(this.options.transport=="console") {
			// this .cli() call is a little helper method provided by winston
			// to format logging messages nicely for console output with colors
			// and tabs and stuff.
			logger.cli();

			// make sure all transports include a timestamp on each message
			// (.cli() turns this off, annoyingly, so we have to turn it on
			// again after we call .cli())
			_.each(logger.transports, function(transport) {
				transport.timestamp = true;
			})
		}

		logger.info("Logging setup!");

		if(this.options["mock-auth-admin"]) {
			mockAdmin = true;
		} else {
			mockAdmin = false;
		}

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
		
		// create the big global collections
		this.users = new models.ServerUserList();
		this.events = new models.ServerEventList();
		this.permalinkSessions = new models.ServerSessionList();

		//----------------------------//
		//			redis setup		  //
		//----------------------------//
		this.redis = redis_lib.createClient(parseInt(this.options.REDIS_PORT), this.options.REDIS_HOST);

    // console.log(this.options.REDIS_PASSWORD);
    this.redis.auth(this.options.REDIS_PASSWORD);
		
		this.redis.on("end", function() {
			logger.error("redis end");
		});

		this.redis.on("error", function(err) {
			logger.error("redis error: " + err);
		});

		this.redis.on("ready", function() {
			logger.info("redis ready");
		});

		// make sure only to run this once, otherwise we trigger
		// all the stuff that happens AFTER redis sets up a second time.
		this.redis.once("ready", _.bind(function(err) {
			if(err) {
				logger.error("Error connecting to redis: " + err);
				this.emit("error", "Error connecting to redis: " + err, err);
				return;
			}
			
			this.inited = true;
			logger.info("UnhangoutServer initialized.");

			// the select call scopes us to a particular redis db, so we can
			// plausibly run this on separate a separate DB for testing or
			// for running multiple concurrent instances or whatever.
			this.redis.select(this.options.REDIS_DB, _.bind(function(err, res) {
				if(err) this.emit("error", err);
				
				// setup redis sync -> backbone models
				sync.init(logger, this.redis);
				sync.setPersist(this.options.persist);
				
				// if we're running in mock auth mode make a fake user object
				// for us to log in with for testing.
				if(this.options['mock-auth']) {
					this.users.add(new models.ServerUser(passportMock.getMockUser()));
				} 
				
				// kick off the model loading from redis.
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

		if(this.options.USE_SSL) {
			try {
				var privateKey = fs.readFileSync(this.options.PRIVATE_KEY).toString();
	    		var cert = fs.readFileSync(this.options.CERTIFICATE).toString();				
			} catch (e) {
				logger.error(e);
				logger.error("Error loading private key or certificate. Ensure that keys are present at the paths specified in conf.json:PRIVATE_KEY/CERTIFICATE");
				logger.error("Shutting down server; can't start without keys present if USE_SSL is true.");
				return;
			}

			this.https = https.createServer({key:privateKey, cert:cert}, this.express);
			logger.log("info", "Created HTTPS server");
		} else {
			this.http = http.createServer(this.express);
			logger.log("info", "Created HTTP server");
		}

		// create a sockjs server, and shim their default built in logging behavior
		// into our standard logger.
		this.sockjs = sockjs_lib.createServer({
			"log":function(severity, message) {
				logger.log("debug", severity + ": " + message);
			},
			"disconnect_delay": this.options.disconnect_delay
		});
		
		// when we get a new sockjs connection, register it and set up 
		this.sockjs.on('connection', _.bind(function(conn) {			
		    logger.info('connection' + conn);
					
			// flag the connection as unauthenticated until we get an authentication message.
			conn.authenticated = false;
			
			// this can be helpful for debugging purposes, to have separate distinct
			// connection ids.
			conn.id = Math.floor(Math.random()*10000000);
			
			// put this connection in the unauthenticated list
			this.unauthenticatedSockets[conn.id] = conn;
		
			// when the connection closes, make sure the user object 
			// hears about it.
		    conn.once('close', _.bind(function() {
				if(conn.authenticated) {
					logger.info("closing id: " + conn.id);
					conn.user.disconnect();
				} else {
					// if they never authenticated, just clean out the unauthenticated
					// sockets list.
					delete this.unauthenticatedSockets[conn.id];
				}
		    }, this));
			
			// this is where the primary protocol specification lives. whenever
			// we get a message FROM a client, this method is called. Messages
			// arive as raw strings.

		    conn.on('data', _.bind(function(string) {

				// TODO wrap this in error handling

				// reject messages that don't JSON parse
				var message;
				try {
					message = JSON.parse(string);
				} catch (e) {
					logger.warn("Error parsing message from client: " + string);
					return;
				}

				// reject messages that don't have a "type" field
				if(!("type" in message)) {
					logger.warn("Received message without 'type' key: " + string);
					return;
				}
				var user;

				// switch on the message type
				//
				// Each message type has some similar components.
				// First, we check for relevant arguments that we need to have
				// to execute the command. Then we assemble the relevant objects
				// for the operation, ie the user object and session object if
				// a user is trying to sign up for a session. Finally,
				// we execute the action on the object, eg call "attend" on the
				// session with the specified user object. 
				//
				// We try whenever possible to return descriptive error messages
				// if something about the arguments is wrong. 
				switch(message.type) {
					case "auth":
						// expecting: "id" and "key"
						if("id" in message.args && "key" in message.args) {
							
							user = this.users.get(message.args.id);
							
							if(_.isUndefined(user)) {
								logger.warn("User presented unrecognized id: " + message.args.id);
								writeErr(conn, "auth");
								return;
							}
							
							// this is the bulk of the command here; we're checking
							// that the key presented in the message is the same as
							// by the user in .getSockKey() - which is called during
							// page load by the templating engine. That sets the key
							// in the server-side user object, and then we check that
							// it matches here. 

							if(user.validateSockKey(message.args.key)) {
								logger.info("AUTHENTICATED sock " + conn.id + " to user " + user.id);
								conn.authenticated = true;
								// TODO send a message to the client acknowledging.
								
								// since the socket is now authenticated, remove it
								// from the unauthenticated pool.
								delete this.unauthenticatedSockets[conn.id];
								
								user.setSock(conn);
								conn.user = user;
								
								writeAck(conn, "auth");
							} else {
								logger.warn("Invalid key presented for user " + user.id);
								writeErr(conn, "auth");
							}
							
						} else {
							logger.warn("Missing 'id' or 'key' in AUTH message payload.");
							writeErr(conn, "auth");
							return;
						}
						break;
					case "join":
						// mark which event page they're on
						user = conn.user;
						
						// check arguments
						if(!("id" in message.args)) {
							user.writeErr("join");
							return;
						}
						
						// confirm the event to be joined exists
						// the getEvent wrapper abstracts this process,
						// including sending error messages to the client
						// if the event doesn't exist (as specified in
						// msg.args)
						var event = this.events.get(message.args.id);
						if(_.isUndefined(event)) {
							user.write("join-err", "Invalid event id.");
							return;
						}

						// if(event instanceof Error) return;
												
						// join it!
						// this will generate the relevant broadcast messages
						// to tell other users that someone has joined. 
						event.userConnected(user);
						user.writeAck("join");
						break;
					case "create-session":
						user = conn.user;

						// enforce admin-ness of the user who is trying to 
						// create a session. 
						if(!user.isAdmin()) {
							logger.warn("User " + user.id + " tried to create-session, but is not an admin.");
							user.writeErr("create-session");
							return;
						}
						
						var event = getEvent(message, user, "create-session");
						if(event instanceof Error) return;

						if("title" in message.args && "description" in message.args) {
							// make the new session!
							var newSession = new models.ServerSession({"title":message.args.title, "description":message.args.description});
							newSession.save();

							// once the id has been set in the save process,
							// add the session to the event.
							logger.debug("pre bind");
							newSession.on("change:id", _.once(function() {
								// the broadcast happens in addSession, as does the event save.
								event.addSession(newSession);
							}));

							user.writeAck("create-session");
						} else {
							user.writeErr("create-session", "Missing name or description in arguments.");
						}
						
						break;
					case "attend":
						// look up the relevant session by id, and mark this user as attending it.
						user = conn.user;
						
						if(!("id" in message.args)) {
							user.writeErr("attend", "missing id in args");
							return;
						}
						
						// get the event first, because we need to have the
						// event object on hand in order to get the sessions
						// from it.
						var event = getEvent(message, user, "attend");
						if(event instanceof Error) return;
						
						var session = getSessionFromMessage(message, user, event, "attend");
						if(session instanceof Error) return;
						
						// addAttendee handles the broadcasting in ServerSession.
						var err = session.addAttendee(user);

						if(err instanceof Error) {
							user.writeErr("attend", e);
						} else {
							user.writeAck("attend");
						}
						
						break;

					case "unattend":
						user = conn.user;

						if(!("id" in message.args)) {
							user.writeErr("unattend", "missing id in args");
							return;
						}
						var event = getEvent(message, user, "unattend");
						if(event instanceof Error) return;
						
						var session = getSessionFromMessage(message, user, event, "unattend");
						if(session instanceof Error) return;

						
						var err = session.removeAttendee(user);
						if(err instanceof Error) {
							user.writeErr("unattend", err);
						} else {
							user.writeAck("unattend");
						}
						
						break;
					case "chat":
						user = conn.user;
						
						if(!("text" in message.args)) {
							user.writeErr("chat", "missing text in chat message");
							return;
						}
						
						var event = getEvent(message, user, "chat");
						if(event instanceof Error) return;
						
						
						var chat = new models.ServerChatMessage({user:user, text:message.args.text});
												
						try {
							// usually we don't do broadcasts in this protocol section, but 
							// we need to do it here because we don't accumulate chat messages
							// on the server in any object (to avoid ever-growing memory
							// requirements over uptime) so there's no other object to generate
							// the message. 
							event.broadcast("chat", chat.toJSON());
							user.writeAck("chat");
						} catch (e) {
							user.writeErr("chat");
						}
						
						break;

					// calling "start" on a session marks it as being ready
					// for participants to join the hangout. on the UI
					// side, this means that participants who signed up for
					// the hangout get a dialog box saying "your hangout
					// is ready!" and everyone gets a (delayed) link in
					// the session list to join the hangout. Basically, this
					// switches a session from sign-up mode to hangout-active
					// mode.
					//
					// somewhat paradoxically, this does not actually START the
					// hangout. We have to rely on a user to do that for us,
					// and then the hangout app will phone-home to the server.
					// At that point, the hangout is actually live. 
					// (see the /session/hangout/:id)
					case "start":
						user = conn.user;
						if(!user.isAdmin()) {
							logger.warn("User " + user.id + " tried to start, but is not an admin.");
							user.writeErr("start");
							return;
						}
						
						var event = getEvent(message, user, "start");
						if(event instanceof Error) return;
						
						var session = getSessionFromMessage(message, user, event, "start");
						if(session instanceof Error) return;
						
						session.start();
						logger.info("Started session: " + session.id);
						user.writeAck("start");
						session.save();
						break;

					// stops all active hangouts. mostly just syntactic sugar,
					// except that there is no stop action at the moment.
					// this is a legacy from our early events where we only
					// ever ran one set of events and then shut down the whole
					// event. Will need to build stop-one-session soon. 
					case "stop-all":
						user = conn.user;
						if(!user.isAdmin()) {
							logger.warn("User " + user.id + " tried to stop-all, but is not an admin.");
							user.writeErr("start");
							return;
						}
						
						var event = getEvent(message, user, "stop");
						if(event instanceof Error) return;

						user.writeAck("stop-all");

						// now get all the sessions from event that have started.
						var liveSessions = event.get("sessions").filter(function(session) {
							return session.isLive();
						});

						_.each(liveSessions, function(session) {
							session.stop();
							session.save();
						});
						break;

					// sets the current video embed. An empty string is considered
					// no embed. 
					case "embed":
						user = conn.user;
						if(!user.isAdmin()) {
							logger.warn("User " + user.id + " tried to set embed, but is not an admin.");
							user.writeErr("embed");
							return;
						}

						var event = getEvent(message, user, "embed");
						if(event instanceof Error) return;
												
						if("ytId" in message.args) {
							event.setEmbed(message.args.ytId);
							user.writeAck("embed");
							event.save();
						} else {
							user.writeErr("embed");
						}

						break;

					// blur and focus are just mini state change events on
					// the user object. they help users track who has the
					// lobby window as their fore-ground window, and who has
					// switched to some other window (probably a hangout)
					// nothing fancy here, just flipping a bit in the user
					// object.
					case "blur":
						 user = conn.user;

						if(!("id" in message.args)) {
							user.writeErr("blur", "missing id in args");
							return;
						}
						
						var event = getEvent(message, user, "blur");
						if(event instanceof Error) return;
						
						user.setBlurred(true);
						
						break;

					case "focus":
						 user = conn.user;

						if(!("id" in message.args)) {
							user.writeErr("focus", "missing id in args");
							return;
						}
						
						var event = getEvent(message, user, "focus");
						if(event instanceof Error) return;
						
						user.setBlurred(false);

						break;

					default:
						logger.warn("Server does not handle '" + message.type + "' type events.");
						break;
				}

				logger.info("message:" + user.id + ":" + message.type + "  " + JSON.stringify(message.args));

		    }, this));
		}, this));
		
		logger.info("sockjs server created");
		
		// sockjs negotiates its startup process over http. so, we need to
		// tell it where in our routing it should put its endpoints.
		this.sockjs.installHandlers(this.http, {prefix:'/sock'});
		
		logger.info("\tsock thandlers installed");
		
		// passport is a library we use for doing google authentication. it
		// abstracts the process of redirecting people to google and dealing
		// with the tokens we get in response.
		//
		// this part deals with creating new user objects.
		passport.use(new GoogleStrategy({
			clientID: this.options.GOOGLE_CLIENT_ID,
			clientSecret: this.options.GOOGLE_CLIENT_SECRET,
			callbackURL: "//" + this.options.HOST + ":" + this.options.PORT + "/auth/google/callback"
		}, _.bind(function(accessToken, refreshToken, profile, done) {

			// Add this newly callback-ed user to our list of known users.
			delete profile["_raw"];

			logger.debug("users.length" + this.users.length);
			
			// Minor note: this whole block assumes that a user can't possibly exist
			// in the database. There is, actually, a case where they WILL exist.
			// When a user joins a permalink hangout, we get some limited information
			// about them and store it as a user object. User objects created that way 
			// will have a lot less information about them, since we didn't get full
			// permissions from that user to access their google plus account.
			var newUser = new models.ServerUser(profile);

			var oldUser = this.users.get(newUser.id);
			if(!_.isUndefined(oldUser)) {
				logger.warn("Found an existing user with id " + newUser.id + " in our user list. It will be replaced. Old user attributes: " + JSON.stringify(oldUser.attributes));
			}
			// we're not really going to do anything special here, except note it in the logs.
			this.users.remove(oldUser);

			// a google plus profile can have more than one email. check
			// all of them to see if any of them are an admin email.
			// if any of them are, mark this user as an admin.
			_.each(_.pluck(newUser.get("emails"), "value"), _.bind(function(email) {
				if(this.options.ADMIN_EMAILS.indexOf(email) > -1) {
					logger.info("Detected login from blessed email account("+this.options.ADMIN_EMAILS+"), granting admin rights.");
					newUser.set("admin", true);
				}
			}, this));
			
			newUser.save();
			this.users.add(newUser);

			logger.debug("users.length" + this.users.length);

			return done(null, newUser.toJSON());
		}, this)));
		
		// we don't need to do anything in serialize, because we write
		// the user to redis when it's created (above) and update that
		// throughout the app. So nothing special to do on logout.
		passport.serializeUser(_.bind(function(user, done) {
			done(null, user.id);
		}, this));
		
		// this part gets existing users from memory
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
		
		// setup the templating engine
		this.express.engine('.ejs', require('ejs').__express);
		this.express.set('views', __dirname + '/../views');
		this.express.set('view engine', 'html');
		
		// express basics. bodyParser is important - makes it easier to extract
		// post parameters from POST requests.
		this.express.use(express.cookieParser());
		this.express.use(express.bodyParser());

		// make sessions available, using redis.
		this.express.use(express.session({ secret: this.options.SESSION_SECRET, store:redisSessionStore, cookie: {maxAge:1000*60*60*24*365}}));
		
		// turn on dummy authentication for testing.
		if(this.options["mock-auth"]) {
			this.express.use(passportMock.initialize(new models.ServerUser(passportMock.getMockUser())));
			logger.info("Using mock-authentication; all users will auth-authenticate as Drew Harry (admin: " + this.options["mock-auth-admin"] + ")");
		} else {
			this.express.use(passport.initialize());
		}

		// plug in the authentication system.
		this.express.use(passport.session());

		// allow cross domain posting from google hangout apps
		this.express.use(allowCrossDomain("*.googleusercontent.com"));

		// do static serving from /public 
		this.express.use("/public", express.static(__dirname + "/../public"));
		
		// routing for the homepage
		this.express.get("/", _.bind(function(req, res) {
			res.render('index.ejs', {user:req.user, events:this.events, event:undefined, _:_, loadApp:false});
		}, this));

		this.express.get("/how-to-unhangout/", _.bind(function(req, res) {
			res.render('how-to-unhangout.ejs', {user:req.user, events: this.events, event:undefined, _:_, loadApp:false});
		}, this));
		
		// routing for events
		// make sure they're authenticated before they join the event.
		this.express.get("/event/:id", ensureAuthenticated, _.bind(function(req, res) {
			// we'll accept either event ids OR shortName fields, for more readable
			// urls. 

			// lets figure out if it's an integer or not.
			var id;
			var e;
			// per http://stackoverflow.com/questions/1019515/javascript-test-for-an-integer
			var intRegex = /^\d+$/;
			if(intRegex.test(req.params.id)) {
				id = parseInt(req.params.id);
				e = this.events.get(id);
				logger.debug("Found event by id.");
			} else {
				// if the reg ex fails, try searching shortnames.
				// (this is inefficient, but still pretty darn cheap in
				//  node.)
				// side: we're assuming shortNames are unique, but I don't
				// think we actually enforce that anywhere. eeek.
				var eventsWithShortName = this.events.filter(function(event) {
					if(event.has("shortName") && !_.isNull(event.get("shortName"))) {
						return event.get("shortName").localeCompare(req.params.id)==0;
					} else {
						return false;
					}
				});

				if(eventsWithShortName.length > 1) {
					logger.warn("Found more than one event with the short name '" + req.params.id = "': " + JSON.stringify(eventsWithShortName));
				} else if(eventsWithShortName.length==1) {
					e = eventsWithShortName[0];
				} else {
					logger.warn(":id was not an integer, and specified short name was not found.");
				}
			}

			if(_.isUndefined(e)) {
				logger.warn("Request for a non-existent event id: " + req.params.id);
				res.status(404);
				res.send();
				return;
			}

			var context = {user:req.user, event:e, _:_, loadApp:true};
			if(!_.isUndefined(farming)) {
				context["numFarmedHangouts"] = farming.getNumHangoutsAvailable();
			}

			res.render('event.ejs', context);
		}, this));
		
		this.express.get('/login', function(req, res) {
			res.render('login', {user:req.user});
		});
		
		// the passport middleware (passport.authenticate) should route this request to
		// google, and not call the rendering callback below.
		this.express.get("/auth/google", passport.authenticate('google', { scope: ['https://www.googleapis.com/auth/userinfo.profile',
		                                            'https://www.googleapis.com/auth/userinfo.email']}),
			function(req, res) {
				logger.warn("Auth request function called. This is unexpected! We expect this to get routed to google instead.");
			}
		);
		
		// after a user authenticates at google, google will redirect them to this url with
		// an authentication token that is consumed by passport.authenticate. 
		this.express.get("/auth/google/callback", passport.authenticate('google', {failureRedirect: '/login'}),
			function(req, res) {

				// if post-auth-path was set, send them to that path now that authentication
				// is complete.
				if("post-auth-path" in req.session) {
					var path = req.session["post-auth-path"];
					delete req.session["post-auth-path"];
					res.redirect(path);
				} else {
					res.redirect("/");
				}
			}
		);
		
		this.express.get("/logout", function(req, res) {
			req.logout();
			res.redirect("/");
		});
		
		// this endpoint connects someone to the hangout for a particular session.
		// the :id in this case is not an actual session id, instead we use
		// session-keys for this. (getSession checks for both)
		// we do this for authentication reasons, so someone can't arbitrarily
		// join a session hangout that isn't started yet or that they're
		// not supposed to have access to. It's a little thing - anyone
		// with access can send the link to anyone else - but it's better
		// than nothing.
		this.express.get("/session/:id", _.bind(function(req, res) {
			var session = getSession(req.params.id, this.events, this.permalinkSessions);
			logger.info("session: " + JSON.stringify(session));

			if(session) {
				// three options at this point:
				// 1. the session is already running and has a hangout link populated -> redirect to hangout
				// 2. the session doesn't have a hangout link, but does have someone pending on starting the hangout -> stall, wait for response
				// 3. the session doesn't have a hangout link, and doesn't yet have a pending link -> send to google
				
				// TWO BIG OPTIONS HERE
				// If we have a farmed url available, prefer that significantly; it resolves a bunch of our issues.
				// so check with the farming module / redis to see if we can do taht. 
				// If that returns an error, then do the fallback strategy, which is to get the first person to click it
				// to generate the session and have that session phone home.
				
				if(session.getHangoutUrl()) {
					logger.info("redirecting user to existing hangout url: " + session.getHangoutUrl());

					// append all the google hangout app info to enforce loading it on startup
					res.redirect(session.getHangoutUrl());
				} else {
					var farmedSesssionURL = farming.getNextHangoutUrl(_.bind(function(err, url) {
						if(err || url==null) {
							logger.warn("ran out of farmed hangout urls! falling back to first-visitor->redirect strategy. isPending? " + session.isHangoutPending());
							// this branch is for the situation when there is no farmed hangout url available.
							if(session.isHangoutPending()) {
								logger.debug("session is pending, waiting on someone else to do it");
								// if it's pending, wait on the hangout-url event.
								// logger.debug("waiting for hangout URL to return for request from user: " + req.user.id);
								session.once("hangout-url", _.bind(function(url) {
									logger.info("issueing redirect to requests waiting for a hangout link to be created: " + url);
									// when we get the hangout url, redirect this request to it.
									res.redirect(url);
								}, this));
							} else {
								// if there isn't a pending request, this is the first user to hit this link.
								// send them to google!
								logger.info("session " + req.params.id + " does not yet have a hangout, and is not pending. sending user " + _.isUndefined(req.user) ? "[id missing]" : req.user.id + " to go make a new hangout.");
								session.startHangoutWithUser(req.user);
								logger.info(session.get("session-key"));

								var url = "https://plus.google.com/hangouts/_" + generateSessionHangoutGDParam(session, this.options);
								logger.debug("redirecting to: " + url);
								res.redirect(url);
							}
						} else {
							// double check that we haven't already set a url on this session
							//		this would happen if two requests came in identically and
							// 		resolved first. 
							if(session.getHangoutUrl()) {
								// and push the url we were going to use back on the end of the 
								// queue.
								logger.warning("encountered a race condition where we over-requested hangout urls for a new hangout. putting the extra one back in the list.");
								farming.reuseUrl(url);
							} else {
								var fullURL = url + generateSessionHangoutGDParam(session, this.options);
								logger.debug("redirecting to: " + fullURL);
								session.set("hangout-url", fullURL);
							}
							logger.info("pulled a new hangout url off the stack; redirecting user to that url: " + url);
							res.redirect(session.getHangoutUrl());
						}
					}, this));
				}
			} else {
				logger.warn("request for unknown session id: " + req.params.id);
				res.status(404);
				res.send();
			}
		
		}, this));

		//---------------------------------------------------------//
		//						PERMALINKS 						   //
		//---------------------------------------------------------//

		this.express.get("/h/", _.bind(function(req, res) {
			res.render('permalink-intro.ejs', {user:undefined, event:undefined, _:_, loadApp:false});
		}, this));

		this.express.get("/h/admin/:code/:key", _.bind(function(req, res) {
			var session = this.permalinkSessions.find(function(s) {
				return s.get("shortCode")===req.params.code;
			});

			if(_.isUndefined(session)) {
				logger.warn("Request for /h/admin/:code/:key with unknown session code: " + req.params.code);
				res.status(404);
				res.send();
				return;
			}

			if(req.params.key===session.get("creationKey")) {
				// now render the normal permalink view, but with the admin interface showing.
				res.render('permalink.ejs', {showAdmin: true, user:undefined, users:this.users, session:session, event:undefined, _:_, loadApp:false});
			} else {
				logger.warn("Attempt to load /h/admin/:code/:key with invalid key for this session: " + req.params.key);
				res.status(403);
				res.send();
				return;
			}

		}, this));

		this.express.get("/h/:code", _.bind(function(req, res) {
			logger.debug("GET /h/" +req.params.code + ": " + JSON.stringify(req.body))
			// okay, this is the permalink part of the site. if this key exists already,
			// then render an appropriate template immediately. if we don't have a 
			// session that matches this code, then create one and then render
			// the page.

			// validate shortcodes here. 
			var re = /^[A-Za-z0-9-_.+]*$/;
			if(!re.test(req.params.code)) {
				logger.warn("GET /h/" + req.params.code + " is not a valid hangout permalink");
				res.status(400);
				res.send();
				return;
			}


			var session = this.permalinkSessions.find(function(s) {
				return s.get("shortCode")===req.params.code;
			});

			if(_.isUndefined(session)) {
				logger.debug("No session found for shortcode: '" + req.params.code + "', creating a new one.");
				session = new models.ServerSession();

				session.set("isPermalinkSession", true);

				// use the specified code for the new session.
				session.set("shortCode", req.params.code);
				this.permalinkSessions.add(session);
				session.start();
				session.generateCreationKey();
				session.set("first-load", true);
				session.save();

				// now redirect them to the admin page for this session.
				logger.info("Redirecting to admin page for a new permalink session code.");
				res.redirect("/h/admin/" + req.params.code + "/" + session.get("creationKey"));
				return;
			}

			// the problem with this is that we don't actually have all users in the
			// hangout in our list of users. That only includes people who have logged
			// in here. Not sure what to do about this. We'll either have to force
			// people to google log in when they land on the page, OR we're
			// going to have to have the participant information sent from the
			// hangout app instead of just the ids involved.

			res.render('permalink.ejs', {showAdmin: false, user:undefined, users:this.users, session:session, event:undefined, _:_, loadApp:false});

			// after rendering, drop the first-load 
			if(session.get("first-load")) {
				session.set("first-load", false);
				session.save();
			}
		}, this));
		
		this.express.post("/h/admin/:code", _.bind(function(req, res) {
			logger.info("POST /h/admin/"+ req.params.code + ": " + JSON.stringify(req.body));
			if(!("creationKey" in req.body)) {
				res.status(400);
				res.send();
				return;
			}

			// otherwise, if creationKey is present, check it against the specified session.
			var session = this.permalinkSessions.find(function(s) {
				return s.get("shortCode")==req.params.code;
			});

			if(_.isUndefined(session)) {
				logger.warn("sess:unknown (set title/desc)" + JSON.stringify(req.body));
				res.status(404);
				res.send();
				return;
			}

			if(req.body.creationKey===session.get("creationKey")) {
				session.set("title", req.body.title);
				session.set("description", req.body.description);
				session.save();

				logger.debug("updating session with params: " + JSON.stringify(req.body));

				res.redirect("/h/" + req.params.code);
			} else {
				logger.warn("POST to /h/admin/:code with invaid creationKey.");
				res.status(403);
				res.send();
				return;
			}
		}, this));

		// this endpoint manually stops a shortcode session.
		// we seem to occasionally get sessions that are broken and stay open when
		// they're supposed to be closed. this lets us fix that issue.
		// this checks global admin status, not per-shortcode admin status.
		// we could at some point add this in to the permalink admin page, but I don't
		// think people actually go back to that.
		this.express.post("/h/:code/stop", ensureAdmin, _.bind(function(req, res) {
			var session = this.permalinkSessions.find(function(s) {
				return s.get("shortCode")==req.params.code;
			});

			if(_.isUndefined(session)) {
				logger.warn("sess:unknown (stop)" + JSON.stringify(req.body));
				res.status(404);
				res.send();
				return;
			}

			// this will cascasde to trigger hangout-stopped, since we're hard-triggering a stop.
			session.set("hangoutConnected", false);
			res.redirect("/admin");
		}, this));


		// all messages from the hangout app running in each of the active hangouts
		// go to this endpoint. 
		// TODO verify that this is using session keys, not sessionids (otherwise it would
		// be super easy to spoof)
		// TODO think about whether we want more security here. the right thing
		// to do would be to require some sort of handshake on election so the keys
		// for posting hangout messages aren't the same as the ones public to all
		this.express.post("/session/hangout/:id", _.bind(function(req, res) {
			logger.debug("POST /session/hangout/" + req.params.id + ":" + req.body.type)
			// TODO need to switch this over to searching through session-keys in the events' domains using _.find
			if(!("id" in req.params)) {
				res.status(404);
				res.send();
				return;
			}

			var session = getSession(req.params.id, this.events, this.permalinkSessions);
			

			if(_.isUndefined(session)) {
				logger.warn("session:unknown " + JSON.stringify(req.body) + " for key " + req.params.id);
				res.status(400);
				res.send();
				return;
			}

			// make sure a type is specified
			if(!("type" in req.body)) {
				res.status(400)
				res.send();
				return;
			}

			// any message to a non-hangout-connected session should make it 
			// be connected.
			if(!session.get("hangoutConnected")) {
				session.set("hangoutConnected", true);
			}

			switch(req.body.type) {
				// in the hangout-farming situation, this behavior of the app is basically vestigal.
				// the server already knows what the url should be, and auto-assigns it before the
				// hangout actually loads. But if we're not farming, this is critical, because the
				// first loader needs to set the actual hangout url.
				//
				// this request is called for every person who loads a hangot. only the first one
				// really has any functional impact, though. subsequent loads will ignore the
				// setHangoutUrl piece because the hangout already has a url.
				case "loaded":
					if(session && "url" in req.body) {
						logger.info("session:" + session.id + ":loaded\tparticipant:" + JSON.stringify(req.body.participant) + "\tparticipants: " + JSON.stringify(req.body.participants) + "\tkey: " + req.params.id + "\turl: " + req.body.url);

						// get the post data; we're expecting the url to be in the payload.
						var url = req.body.url;
						logger.info("cur session url: " + session.getHangoutUrl() + "; setting to: " + url);

						// the session will ignore this if it already has a url.
						var fullURL = url + generateSessionHangoutGDParam(session, this.options);
						// logger.debug("(trying to) set hangout url to: " + fullURL);
						session.setHangoutUrl(fullURL);

						res.status(200);
						res.send();
					} else {
						logger.warn("request for unknown session id: " + req.params.id + " or missing payload: " + JSON.stringify(req.body));
						res.status(404);
						res.send();
					}

					break;

				// sent any time someone joins or leaves a hangout. contains the full
				// participant list every time.
				case "participants":
					// update the current participant list for this session. 
					if(session && "participants" in req.body) {

						// we need to look and see if we have this user id in our this.users
						// list. if we don't, we need to keep track of them somehow. not
						// sure exactly where to put this just yet.
						var participantIds = _.map(req.body.participants, function(participant) {
							return participant.person.id;
						});

						// TODO start checking to see if we have all these participants in our user list
						// and if their id is not tracked in users, add them in. This will help us rendering
						// their pictures elsewhere in the app without much trouble.
						_.each(req.body.participants, _.bind(function(participant) {
							if(_.isUndefined(this.users.get(participant.person.id))) {
								logger.debug("creating new user object");

								var newUserAttrs = {displayName:participant.person.displayName,
									id:participant.person.id};

								if(participant.person.image) {
									newUserAttrs["picture"] = participant.person.image.url;
								}

								var newUser = new models.ServerUser(newUserAttrs);
								newUser.set("createdViaHangout", true);
								this.users.add(newUser);
								newUser.save();
							} else {
								// TODO perhaps add a flag that this user was seen in a permalink
								// based hangout? 
							}
						}, this));

						logger.info("session:" + session.id + ":participants\t" + JSON.stringify(participantIds));

						session.setConnectedParticipantIds(participantIds);

						// count this as a heartbeat, since it represents active hangout activity. Useful since
						// the first heartbeat isn't for 5 seconds, and in some situations there might be an 
						// extant heartbeat-check interval running that could fire before this new participant
						// picks up heartbeat responsibilities.
						session.heartbeat();
					} else {
						logger.warn("Received a request for participants missing appropriate session key or participants field.");
						res.status(404);
						res.send();
					}
					break;
				// hangouts send heartbeats every 5 seconds so we can tell that the
				// hangout is still running. this is because there is not a reliable
				// "closing hangout" message, so we have to infer it from heartbeats
				// disappearing.
				case "heartbeat":
					logger.debug("session:" + session.id + ":heartbeat\t" + new Date().getTime());
					session.heartbeat();
					break;
				default: 
					logger.warn("Got unknown hangout post: " + JSON.stringify(req.body));
					break;
			}
			// after whatever manipulation we've done, save the session.
			session.save();


			// Close out the requests successfully, assuming that if anything else were wrong
			// they would have been closed out and the method returned earlier in execution.
			res.status(200);
			res.send();
		}, this));

		this.express.post("/subscribe", _.bind(function(req, res) {
			logger.debug("POST /subscribe");

			// save subscription emails
			if("email" in req.body && req.body.email.length > 5 && req.body.email.length < 100) {
				this.redis.lpush("global:subscriptions", req.body.email);
				logger.info("subscribed email: " + req.body.email);
				res.status(200);
				res.send();
			} else {
				res.status(400);
				res.send();
			}
		}, this));

		this.express.get("/admin", ensureAuthenticated, ensureAdmin, _.bind(function(req, res) {
			logger.info("GET /admin");

			var sortedPermalinkSesssions = this.permalinkSessions.sortBy(function(s) {
				return s.get("user-seconds") * -1;
			});

			sortedPermalinkSesssions = _.sortBy(sortedPermalinkSesssions, function(s) {
				return s.get("connectedParticipantIds").length * -1;
			});

			// now prepend all event sessions 
			var sessions = _.flatten(this.events.map(function(event) {
				if(event.isLive()) {
					return event.get("sessions").toArray();
				} else {
					return [];
				}
			}));

			var allSessions = sessions.concat(sortedPermalinkSesssions);

			res.render('admin.ejs', {user:req.user, events:this.events, sessions:allSessions, event:undefined, _:_, loadApp:false});
		}, this));

		this.express.get("/admin/event/new", ensureAuthenticated, ensureAdmin, _.bind(function(req, res) {
			logger.debug("GET /admin/event/new");
			var event = this.events.get(req.params.id);

			var context = {user:req.user, events:this.events, event:event, _:_, loadApp:false, create:true};

			res.render('admin-event.ejs', context);
		}, this));

		this.express.post("/admin/event/new", ensureAuthenticated, ensureAdmin, _.bind(function(req, res) {
			logger.debug("POST /admin/event/new " + JSON.stringify(req.body));

			// make sure title and description are present, otherwise reject the request.
			if(!("title" in req.body) || !("description" in req.body)) {
				res.status(400);
				res.send();
				return;
			}

			var event = new models.ServerEvent({title:req.body.title, shortName:req.body.shortName, description:req.body.description,
					welcomeMessage:req.body.welcomeMessage, organizer:req.body.organizer});

			event.save();
			this.events.add(event);

			logger.info("Created a new event: " + JSON.stringify(event));

			res.redirect("/admin");
		}, this));

		this.express.post("/admin/event/:id/start", ensureAuthenticated, ensureAdmin, _.bind(function(req, res) {
			var event = this.events.get(req.params.id);

			if(_.isUndefined(event)) {
				logger.warn("Attempt to stop unknown event id: " + req.params.id);
				res.status(404);
				res.send();
				return;
			};

			var err = event.start();

			if(err) {
				res.status(500);
				res.send(err);
				return;
			}

			logger.info("Started event:" + req.params.id);

			res.redirect("/admin/");
		}, this));

		this.express.post("/admin/event/:id/stop", ensureAuthenticated, ensureAdmin, _.bind(function(req, res) {
			var event = this.events.get(req.params.id);

			if(_.isUndefined(event)) {
				logger.warn("Attempt to start unknown event id: " + req.params.id);
				res.status(404);
				res.send();
				return;
			};

			var err = event.stop();
			if(err) {
				res.status(500);
				res.send(err);
				return;
			}

			logger.info("Stopped event:" + req.params.id);

			res.redirect("/admin/");
		}, this));

		this.express.get("/admin/event/:id", ensureAuthenticated, ensureAdmin, _.bind(function(req, res) {
			var event = this.events.get(req.params.id);

			if(_.isUndefined(event)) {
				logger.warn("Attempt to load unknown event id: " + req.params.id);
				res.status(404);
				res.send();
				return;
			};

			res.render('admin-event.ejs', {user:req.user, events:this.events, event:event, _:_, loadApp:false, create:false})
		}, this));


		this.express.post("/admin/event/:id", ensureAuthenticated, ensureAdmin, _.bind(function(req, res) {
			var event = this.events.get(req.params.id);

			if(_.isUndefined(event)) {
				logger.warn("Attempt to update unknown event id: " + req.params.id);
				res.status(404);
				res.send();
				return;
			};

			var shouldBroadcast = false;

			if(event.get("description")!=req.body.description) {
				shouldBroadcast = true;
			}

			// now we need to update everything...
			event.set("title", req.body.title);
			event.set("shortName", req.body.shortName);
			event.set("description", req.body.description);
			event.set("welcomeMessage", req.body.welcomeMessage);
			event.set("organizer", req.body.organizer);
			event.save();

			logger.debug("new event attributes: " + JSON.stringify(event));

			if(shouldBroadcast) {
				event.broadcast("event-update", event.toJSON());
			}

			res.redirect("/admin/event/" + event.id);
		}, this));

		this.express.get("/")
		
		// hand off the express object so the hangout farming code can 
		// set up their required listeners.
		farming.init(this);
		
		this.http.listen(process.env.PORT || this.options.PORT);

		if(this.options.timeoutHttp) {
			this.http.setTimeout(400);
		}

		logger.info("http server listening");
		
		this.emit("started");
		this.running = true;
	},
	
	// stops the unhangout server. 
	stop: function() {
		if(!this.running) {
			logger.warn("Tried to stop a server that was not running.");
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
				var newUser = new models.ServerUser(attrs);
				// no need to save since we're pulling from the
				// database to begin with.
				this.users.add(newUser);
				callback();
			}, this),
			
			"event/?????":_.bind(function(callback, attrs, key) {
				var newEvent = new models.ServerEvent(attrs);				
				this.events.add(newEvent);
				callback();
			}, this),
			
			"event/*/sessions/*":_.bind(function(callback, attrs, key) {
				var eventId = parseInt(key.split("/")[1]);

				var event = this.events.get(eventId);
				var newSession = new models.ServerSession(attrs);
				event.addSession(newSession);
				
				callback();
			}, this),

			"session/permalink/*":_.bind(function(callback, attrs, key) {
				var newSession = new models.ServerSession(attrs);

				// force these to be true. This fixes a transient condition where some
				// keys in the db didn't have this set and it defaults to false.dw
				newSession.set("isPermalinkSession", true);

				this.permalinkSessions.add(newSession);
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

// a simple express middleware to enforce authentication. 
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) { return next(); }
  req.session["post-auth-path"] = req.path;
  res.redirect('/auth/google');
}

function ensureAdmin(req, res, next) {
	if(mockAdmin) next();
	else {
		logger.info("admin check: " + req.user.get("displayName"));
		if(req.user.isAdmin()) {
			next();
		} else {
			res.redirect("/");
		}
	}
}

// an express middleware that we apply to the entire site.
// for some reason, that works better than applying it just to the
// resources that actually need to be accessed cross domain.
var allowCrossDomain = function(domain) {
	return function(req, res, next) {
	    res.header('Access-Control-Allow-Origin', domain);
	    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
	    res.header('Access-Control-Allow-Headers', 'Content-Type');

	    next();
	}
}

// Mix in the node events structures so we have on/emit available on the server.
// This is helpful for testing and various other sorts of indirection.
_.extend(exports.UnhangoutServer.prototype, EventEmitter.prototype);

// helper methods to do repetetive protocol-related work of extracting
// sessions from messages and dealing with errors.
function getSessionFromMessage(message, user, event, type) {
	var session = event.get("sessions").get(message.args.id);
	
	if(_.isNull(session) || _.isUndefined(session)) {
		user.writeErr(type, "session is not in event list");
		return new Error("session is not in event list");
	} else {
		return session;
	}
}

// like above, but for events.
function getEvent(message, user, type) {
	var event = user.get("curEvent");
	if(_.isNull(event) || _.isUndefined(event)) {
		user.writeErr(type, "user has no event");
		return new Error("user has no event");
	} else {
		return event;
	}
}

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

function getSession(sessionId, events, permalinkSessions) {

	// logger.debug("sessionId: " + sessionId);
	// this is a bit silly, but we don't maintain a separate dedicated list of sessions,
	// and there's no easy way to map back from a session id to that session's event.
	// so, create a temporary list of sessions to look up against.
	var sessions = _.flatten(events.map(function(event) {
		return event.get("sessions").toArray();
	}));
	
	// add in the permalink sessions.
	sessions = _.union(sessions, permalinkSessions.toArray());
	var session = _.find(sessions, function(session) {

		if(_.isNull(session.get("session-key")) || _.isUndefined(session.get("session-key"))) {
			// logger.debug("ignoring session without a session key");
			return false;
		} else {
			// logger.debug("id: " + session.id + "; key: " + session.get("session-key") + " title: " + session.get("title"));
			// logger.debug(".id===id: " + (session.id===parseInt(sessionId) + "") + " : session-key===id: " + ("" + (session.get("session-key")===sessionId)));
		}

		// TODO try just doing the second clause here. why does the first one even exist?
		// return session.id===parseInt(sessionId) || session.get("session-key")===sessionId;
		return session.get("session-key")===sessionId;
	});

	// logger.debug("returning session: " + JSON.stringify(session));
	
	return session;
}

function generateSessionHangoutGDParam(session, options) {
	logger.debug("generating url for session: " + JSON.stringify(session));

	// replace : with | in any free-text field like title and description
	return "?gid="+options.HANGOUT_APP_ID + 
		"&gd=" + options.HOST + ":" + options.PORT + ":" + 
		session.get("session-key") +':'+ encodeURIComponent(session.get('title').replace(":", "|")) +':'+ encodeURIComponent(session.get("isPermalinkSession") ? session.get('description').replace(":", "|") : "none") +':'+
		session.get('shortCode') + ':' + session.get("isPermalinkSession") + ':' + encodeURIComponent(session.collection.event ? session.collection.event.get("title").replace(":", "|") : "none");
}

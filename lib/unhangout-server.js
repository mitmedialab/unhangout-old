var logging = require('./logging'),
    logger = logging.getLogger(),
    _ = require('underscore')._,
    EventEmitter = require('events').EventEmitter,
    UnhangoutDb = require('./unhangout-db'),
    UnhangoutSocketManager = require('./unhangout-sockets').UnhangoutSocketManager,
    //UnhangoutSocketManager = require('./unhangout-rooms').UnhangoutSocketManager,
    unhangoutRoutes = require('./unhangout-routes'),
    permalinkRoutes = require('./permalink-routes'),
    models = require('./server-models.js'),
    utils = require('./utils'),
    farming = require('./hangout-farming.js'),
    requireAssets = require('./require-assets.js'),
    monotonic = require("./monotonic-counter.js"),
    async = require('async'),
    express = require('express'),
    RedisStore = require('connect-redis')(express),
    http = require('http'),
    https = require('https'),
    nodemailer = require("nodemailer");
    passport = require('passport'),
    GoogleStrategy = require('passport-google-oauth').OAuth2Strategy,
    stylus = require('stylus'),
    nib = require('nib'),
    moment = require('moment'),
    fs = require('fs'),
    memwatch = require("memwatch"),
    slashes = require("connect-slashes");

// This is the primary class that represents the UnhangoutServer.
// I organize the server pieces into a class so we can more easily
// manage the lifecycle of the server in an object-oriented way.
// In particular, this makes testing much more tractable.
// The server has four main lifecycle methods:
//
//    1. init()        prepare the server for starting - connect to DB, load models, etc. does not bind to any ports or start handling requests
//    2. start()        start the http + sockjs serving cores
//    3. stop()        shut down the externally facing connections, close all existing client connections, etc. in theory, you should be able to call start() after stop() but I haven't tested that lately.
//    4. destroy()    dereference all the major class variables
//
// Each of these lifecycle methods emits an event when it completes, eg 'inited', 'started', 'stopped', 'destroyed'
//
//

// the constructor does basically nothing, since all substantive setup
// takes place in init() instead.
exports.UnhangoutServer = function() {

}

exports.UnhangoutServer.prototype = {
    options: null,  // passed in to init(), configuration options
    running: false, // true if server is started
    inited: false,  // flag to check initialization state

    app: null,      // reference to the http express app
    http: null,     // reference to the node http server base object

    init: function(options) {
        this.options = options;

        // TODO is it bad for this to be the same as the session secret?
        // leaving the same for now.
        models.USER_KEY_SALT = this.options.UNHANGOUT_SESSION_SECRET;

        this.db = new UnhangoutDb(options);
        // Attaching our smtp transport to 'db'.  Kindof makes sense... sending
        // email is persisting data, right?
        this.db.smtpTransport = nodemailer.createTransport("SMTP", options.UNHANGOUT_SMTP);
        this.db.init(_.bind(function(err) {
            if (!err) {
                this.inited = true;
                this.emit("inited");
                logger.analytics("server", {action: "init"});
            }
        }, this));

        // Configure memory leak detection and warnings.
        if (process.env.NODE_DEBUG_LEAKS === "1") {
            memwatch.on('leak', function(info) {
                logger.warn("LEAK", info);
            });
            this.heapDiff = null;
            setInterval(function() {
                // log a heap diff.
                if (this.heapDiff != null) {
                    logger.warn("HEAP DIFF", this.heapDiff.end());
                }
                this.heapDiff = new memwatch.HeapDiff();
            }.bind(this), 1000);
        }
    },

    start: function() {
        if(!this.inited) {
            logger.error("Attempted to start, but server is not initialized.");
            this.emit("error", "Attempted to start, but server is not initialized.");
            return;
        }

        this.app = express();
        this.app.enable("trust proxy");
        this.app.locals = {
            _: _,
            moment: moment,
            sanitize: utils.sanitize,
            requireScripts: requireAssets.requireScripts,
            user: undefined,
            baseUrl: this.options.baseUrl,
            monotonic: monotonic,
            NODE_ENV: process.env.NODE_ENV
        }

        if(this.options.UNHANGOUT_USE_SSL) {
            try {
                var privateKey = fs.readFileSync(this.options.UNHANGOUT_PRIVATE_KEY).toString();
                var cert = fs.readFileSync(this.options.UNHANGOUT_CERTIFICATE).toString();
            } catch (e) {
                logger.error(e);
                logger.error("Error loading private key or certificate. Ensure that keys are present at the paths specified in conf.json:PRIVATE_KEY/CERTIFICATE");
                logger.error("Shutting down server; can't start without keys present if USE_SSL is true.");
                return;
            }

            this.http = https.createServer({key:privateKey, cert:cert}, this.app);
            logger.log("info", "Created HTTPS server");
        } else {
            this.http = http.createServer(this.app);
            logger.log("info", "Created HTTP server");
        }
        if(this.options.UNHANGOUT_REDIRECT_HTTP) {
            this.httpRedirect = require("./redirect-https")();
        }

        this.socketManager = new UnhangoutSocketManager(this.http, this.db, this.options);
        this.socketManager.init();

        // passport is a library we use for doing google authentication. it
        // abstracts the process of redirecting people to google and dealing
        // with the tokens we get in response.
        //
        // this part deals with creating new user objects and updating existing
        // ones on login.
        passport.use(new GoogleStrategy({
            clientID: this.options.UNHANGOUT_GOOGLE_CLIENT_ID,
            clientSecret: this.options.UNHANGOUT_GOOGLE_CLIENT_SECRET,
            callbackURL: this.options.baseUrl + "/auth/google/callback"
        }, _.bind(this.db.users.registerOrUpdate, this.db.users)));

        // we don't need to do anything in serialize, because we write
        // the user to redis when it's created (above) and update that
        // throughout the app. So nothing special to do on logout.
        passport.serializeUser(_.bind(function(user, done) {
            done(null, user.id);
        }, this));

        // this part gets existing users from memory
        passport.deserializeUser(_.bind(function(id, done) {
            var user = this.db.users.get(id);
            if(_.isNull(user)) {
                logger.error("Tried to deserialize a user that did not exist; user:" + id);
                done(new Error('user/' + id + " does not exist."));
            } else {
                done(null, user);
            }
        }, this));

        var redisSessionStore = new RedisStore({client:this.db.redis});

        // setup the templating engine
        this.app.engine('.ejs', require('ejs').__express);
        this.app.set('views', __dirname + '/../views');
        this.app.set('view engine', 'html');

        // express basics.
        this.app.use(logging.analyticsMiddleware()); // Put this first so we can track request durations.
        this.app.use(express.cookieParser());
        this.app.use(express.urlencoded());
        this.app.use(express.json());

        // make sessions available, using redis.
        // expiration is now set to 2 days, to avoid buildup. It seems like the
        // heartbeat messages are causing sessions to be created for each request, which is
        // overloading the session store.
        this.app.use(express.session({
            secret: this.options.UNHANGOUT_SESSION_SECRET,
            store: redisSessionStore,
            cookie: {maxAge:1000*60*60*24*2}
        }));

        if (this.options.mockAuth) {
            var mockPassport = require("./passport-mock");
            this.app.use(mockPassport.mockAuthMiddleware(this));
        }

        // plug in the authentication system.
        this.app.use(passport.initialize());
        this.app.use(passport.session());

        // Put 'tooBusy' handler after passport, so we can whitelist superusers
        // from 503 "Over capacity" throttling.
        this.app.use(utils.tooBusyMiddleware());

        // Compilation of stylus files for development.  In production, we
        // compile them offline (see bin/compile-assets.js).
        if (process.env.NODE_ENV !== "production") {
            this.app.use(stylus.middleware({
                src: __dirname + "/../",
                compile: function(str, path) {
                    return stylus(str).set('filename', path).use(nib()).import('nib');
                }
            }));
        }

        //
        // Routes
        //

        // do static serving from /public
        this.app.use("/public", express.static(__dirname + "/../public"));
        this.app.use("/public", express.static(__dirname + "/../builtAssets"));
        unhangoutRoutes.route(this.app, this.db, this.options);
        permalinkRoutes.route(this.app, this.db, this.options);
        farming.init(this.app, this.db, this.options);
        this.app.use(slashes());

        // Start listening.
        this.http.listen(this.options.UNHANGOUT_PORT);

        logger.info("http server listening on port " + this.options.UNHANGOUT_PORT);
        this.emit("started");
        this.running = true;
        logger.analytics("server", {
            action: "start",
            host: this.options.UNHANGOUT_HOST,
            port: this.options.UNHANGOUT_PORT,
            totalUsers: this.db.users.length,
            totalEvents: this.db.events.length,
            totalPermalinkSessions: this.db.permalinkSessions.length
        });
    },

    // stops the unhangout server.
    stop: function() {
        if(!this.running) {
            logger.warn("Tried to stop a server that was not running.");
            this.emit("error", "Tried to stop a server that was not running.");
            return;
        }
        logger.info("http server shutting down");
        this.emit("stopping");

        this.db.smtpTransport.close();
        this.socketManager.shutdown(_.bind(function(err, message) {
            logger.info("Socket manager stopped");
            if (err) {
                logger.error(err)
            }
            if(this.httpRedirect) {
                this.httpRedirect.close();
            }

            this.http.close();

            this.http.on("close", _.bind(function() {
                logger.info("HTTP Closed");
                this.running = false;
                this.emit("stopped");
                logger.analytics("server", {
                    action: "stop",
                    host: this.options.UNHANGOUT_HOST,
                    port: this.options.UNHANGOUT_PORT
                });
            }, this));
        }, this));
    },

    destroy: function() {
        this.app = null;
        this.http = null;
        this.socketManager = null;

        this.httpRedirect = null;

        logger.info("destroyed");
        this.emit("destroyed");
        this.options = this.options || {};
        logger.analytics("server", {
            action: "destroy",
            host: this.options.UNHANGOUT_HOST,
            port: this.options.UNHANGOUT_PORT
        });
    }
}


// Clean up 'toobusy' so it doesn't block shutdown of thread.
process.on('SIGINT', function() {
    require("toobusy").shutdown();
    process.exit();
});

// Mix in the node events structures so we have on/emit available on the server.
// This is helpful for testing and various other sorts of indirection.
_.extend(exports.UnhangoutServer.prototype, EventEmitter.prototype);

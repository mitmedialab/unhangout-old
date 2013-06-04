var winston = require('winston'),
	_ = require('underscore')._,
	EventEmitter = require('events').EventEmitter,
	express = require('express'),
	http = require('http'),
	passport = require('passport'),
	GoogleStrategy = require('passport-google-oauth').OAuth2Strategy,
	sockjs_lib = require('sockjs');

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
	
	init: function(options) {
		if(_.isUndefined(options)) {
			options = {};
		}
		
		this.options = _.defaults(options, {"level":"debug", "transport":"console", "HOST":"localhost", "PORT":7777});
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
		
		this.inited = true;
		logger.info("UnhangoutServer initialized.");
		this.emit("inited");
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
		
		logger.info("sockjs server created");
		
		this.sockjs.installHandlers(this.http, {prefix:'/sock'});
		
		logger.info("\tsock thandlers installed");
		
		this.http.listen(this.options.PORT);
		logger.info("http server listening");
		
		// passport.use(new GoogleStrategy({
		// 	
		// }));
		
		
		this.express.engine('.ejs', require('ejs').__express);
		this.express.set('views', __dirname + '/../views');
		this.express.set('view engine', 'html');
		this.express.use("/public", express.static(__dirname + "/../public"));
		
		this.express.use(express.cookieParser());
		this.express.use(express.bodyParser());
		this.express.use(express.session({ secret: '09n23fonslnflkan3lf9n'}));          //TODO load the secret from env_vars
		this.express.use(passport.initialize());
		this.express.use(passport.session());
		
		this.express.get("/", function(req, res) {
			res.render('index.ejs', {layout:false});
		});
		
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
	}
}

// Mix in the node events structures so we have on/emit available on the server.
// This is helpful for testing and various other sorts of indirection.
_.extend(exports.UnhangoutServer.prototype, EventEmitter.prototype);
var winston = require('winston'),
	_ = require('underscore')._,
	EventEmitter = require('events').EventEmitter,
	express = require('express'),
	http = require('http'),
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
	
	init: function(options) {
		if(_.isUndefined(options)) {
			options = {};
		}
		
		this.options = _.defaults(options, {"level":"debug", "transport":"console", "host":"localhost", "port":7777});
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
		
		logger.info("UnhangoutServer initialized.");
	},
	
	start: function() {
		logger.log("info", "Starting UnhangoutServer on %s:%d", this.options.host, this.options.port);
		
		this.express = express();
		this.http = http.createServer(express);
		this.sockjs = sockjs_lib.createServer({
			"log":function(severity, message) {
				logger.log("debug", severity + ": " + message);
			},
			"disconnect_delay": this.options.disconnect_delay
		});
		
		logger.info("sockjs server created");
		
		this.sockjs.installHandlers(this.http, {prefix:'/sock'});
		
		logger.info("\sock thandlers installed");
		
		this.http.listen(this.options.port);
		logger.info("http server listening");
		
		this.emit("started");
	},
	
	stop: function() {
		logger.info("Stopping UnhangoutServer!");
		
		// TODO gracefully disconnect all users
		
		this.http.close();
		
		this.http.on("close", _.bind(function() {
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
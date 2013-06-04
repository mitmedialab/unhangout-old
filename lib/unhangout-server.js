var winston = require('winston'),
	_ = require('underscore')._,
	express = require('express'),
	sockjs_lib = require('sockjs');

var logger;

exports.UnhangoutServer = function() {

}

exports.UnhangoutServer.prototype = {
	options: null,
	running: false,
	
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
	},
	
	stop: function() {
		logger.info("Stopping UnhangoutServer!");
	}
}
var winston = require('winston'),
	_ = require('underscore')._,
	express = require('express'),
	sockjs_lib = require('sockjs');

var logger= new (winston.Logger)({
    transports: [
        new (winston.transports.Console)({
            timestamp:true,
            })
    ],
    levels: winston.config.syslog.levels
});

logger.cli();


exports.UnhangoutServer = function() {
	logger.info("UnhangoutServer constructed.");
}

exports.UnhangoutServer.prototype = {
	options: null,
	running: false,
	
	init: function(options) {
		if(_.isUndefined(options)) {
			options = {};
		}
		this.options = _.defaults(options, {"verbose":true});
		
		_.each(logger.transports, _.bind(function(key, transport) {
			if(this.options.verbose) {
				transport.level = "debug";
				logger.debug("Set debug logging.");
			} else {
				transport.level = "info";
			}
		}, this));
		
		logger.info("UnhangoutServer initialized.");
	},
	
	start: function() {
		logger.info("Starting UnhangoutServer!");
	},
	
	stop: function() {
		logger.info("Stopping UnhangoutServer!");
	}
}
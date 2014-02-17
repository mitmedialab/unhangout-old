var winston = require('winston'),
    // This should be the one library in the whole app that loads conf.json
    // directly, rather than loading ``lib/options.js``, as we want to be able to
    // log problems with conf.json.
    conf = require('../conf.json'),
    winstonMail = require('winston-mail'),
    _ = require('underscore');

var logger = new (winston.Logger)();
if (process.env.NODE_ENV === "production") {
    logger.add(winston.transports.File, {
        filename: __dirname + '/../logs/server.log',
        level: 'info'
    });
    if (conf.EMAIL_LOG_RECIPIENTS && conf.EMAIL_LOG_RECIPIENTS.length > 0) {
        var username, password;
        if (conf.UNHANGOUT_SMTP.auth) {
            username = conf.UNHANGOUT_SMTP.auth.username;
            password = conf.UNHANGOUT_SMTP.auth.password;
        }

        logger.add(winstonMail.Mail, {
            level: 'error',
            to: conf.EMAIL_LOG_RECIPIENTS.join(","),
            from: conf.UNHANGOUT_SERVER_EMAIL_ADDRESS || "node@localhost",
            host: conf.UNHANGOUT_SMTP.host || "localhost",
            port: conf.UNHANGOUT_SMTP.port || (conf.UNHANGOUT_SMTP.secureConnection ? 587 : 25),
            secure: conf.UNHANGOUT_SMTP.secureConnection || false,
            username: username || undefined,
            password: password || undefined,
            silent: false,
            handleExceptions: true
        });
    } else {
        logger.warn("No EMAIL_LOG_RECIPIENTS specified; skipping email logger transport.")
    }
} else if (process.env.NODE_ENV === "testing") {
    logger.add(winston.transports.Console, {level: 'crit'});
    logger.cli();
} else {
    logger.add(winston.transports.Console, {level: 'debug'});
    logger.cli();
}

//
// A second logger for analytics -- log to file, in a more tightly
// controlled format.
//
var analyticsLogger = new (winston.Logger)();
analyticsLogger.add(winston.transports.File, {
    filename: __dirname + "/../logs/analytics.log",
    level: 'info',
    timestamp: true,
    maxsize: 10000000 // 10 MB
});
logger.analytics = function(key, opts) {
    var args = {};
    opts = opts || {};
    if (opts.req) {
        args.url = opts.req.originalUrl || opts.req.url;
        args.method = opts.req.method;
        args['user-agent'] = opts.req.headers['user-agent'];
        args.referrer = opts.req.headers['referer'] || opts.req.headers['referrer'];
        args['remote-addr'] = opts.req.ip;
        if (opts.req.user) {
            args.userId = opts.req.user.id;
        }
        delete opts.req;
    }
    if (opts.res) {
        args.status = opts.res.statusCode;
        if (opts.res._errorReason) {
            args.errorReason = opts.res._errorReason;
        }
        if (args.status == 301 || args.status == 302) {
            args.location = opts.res.get('location');
        }
        delete opts.res;
    }
    if (opts.socket) {
        if (opts.socket.user) {
            args.userId = opts.socket.user.id;
        }
        delete opts.socket;
    }
    if (opts.user) {
        args.userId = opts.user.id;
        delete opts.user;
    }
    if (opts.event) {
        args.eventId = opts.event.id;
        delete opts.event;
    }
    if (opts.session) {
        args.sessionId = opts.session.id;
        delete opts.session;
    }
    _.extend(args, opts);
    analyticsLogger.info(key, args)
    // Assume we always want to shadow analytics logs with debug logs.
    //logger.debug(key, args)
};

module.exports = {
    getLogger: function() {
        return logger;
    },
    // Connect middleware for logging, for analytics.
    analyticsMiddleware: function() {
        return function(req, res, next) {
            req._startTime = new Date();
            // Cache the original res.end, and replace it with our own, to log once
            // the request is finished.
            var end = res.end;
            res.end = function(chunk, encoding) {
                // restore original res.end and call it.
                res.end = end;
                res.end(chunk, encoding);
                // Log!
                logger.analytics("route", {
                    req: req,
                    res: res,
                    'response-time': new Date() - req._startTime,
                });
            }
            // Proceed with next middleware.
            next();
        }
    }
}

// Run a logging test if we were executed as a script.
if (require.main === module) {
    logger = module.exports.getLogger();
    logger.debug("Test log (level: debug)", {metadata: "fun", level: "debug"});
    logger.info("Test log (level: info)", {metadata: "fun", level: "info"});
    logger.warn("Test log (level: warn)", {metadata: "fun", level: "warn"});
    logger.error("Test log (level: error)", {metadata: "fun", level: "error"});
}

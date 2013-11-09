var winston = require('winston'),
    conf = require('../conf.json'),
    winstonMail = require('winston-mail');

module.exports = {
    getLogger: function() {
        logger = new (winston.Logger)();
        if (process.env.NODE_ENV === "production") {
            logger.add(winston.transports.File, {
                filename: __dirname + '/../logs/server.log',
                level: 'info'
            });
            if (conf.EMAIL_LOG_RECIPIENTS && conf.EMAIL_LOG_RECIPIENTS.length > 0) {
                logger.add(winstonMail.Mail, {
                    level: 'error',
                    to: conf.EMAIL_LOG_RECIPIENTS.join(","),
                    host: conf.EMAIL_LOG_HOST || "localhost",
                    port: conf.EMAIL_LOG_PORT || (conf.EMAIL_LOG_SECURE ? 587 : 25),
                    secure: conf.EMAIL_LOG_SECURE || false,
                    username: conf.EMAIL_LOG_USERNAME || undefined,
                    password: conf.EMAIL_LOG_PASSWORD || undefined,
                    silent: false
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
        return logger;
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

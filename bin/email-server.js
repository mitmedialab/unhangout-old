#!/usr/bin/env node
//
// This is a simple SMTP server which can be invoked with a handler callback
// that processes the incoming message.  In addition, messages are stored in
// the module's `outbox` array for later inspection.
//
// Use it for testing and development.
//
// Log mail to the console by invoking as a script; or use other ways with:
//
//      var emailServer = require("email-server");
//      emailServer.start(handler,
//                        <port (default to conf.UNHANGOUT_SMTP_PORT or 2525)>,
//                        <started calback>);
//       
//      `handler(parsedMessage)`: called with a parsedMail object (see
//          https://github.com/andris9/mailparser#parsed-mail-object)

var simplesmtp = require("simplesmtp"),
    conf = require("../lib/options"),
    logger = require("../lib/logging").getLogger(),
    MailParser = require("mailparser").MailParser;

var smtp = null;
var outbox = [];

var start = function(messageHandler, port, started) {
    var port = port || conf.UNHANGOUT_SMTP_PORT;
    if (!port) {
        logger.warn("SMTP: no port specified, defaulting to 2525.");
        port = 2525;
    }

    smtp = simplesmtp.createServer({disableDNSValidation: true});
    smtp.listen(port, function(err) {
        if (err) { return logger.error(err); }
        smtp.on("startData", function(envelope) {
            envelope.parser = new MailParser({defaultCharset: "utf-8"});
            envelope.parser.on("end", function(mail) {
                outbox.push(mail);
                messageHandler(mail);
            });
        });
        smtp.on("data", function(envelope, chunk) {
            envelope.parser.write(chunk);
        });
        smtp.on("dataReady", function(envelope, callback) {
            envelope.parser.end();
            callback(null);
        });
        started && started();
    });
};

var stop = function(callback) {
    if (smtp) {
        try {
            return smtp.end(callback);
        } catch (e) {
            if (e.message != "Not running") {
                throw e;
            }
            return callback(null);
        }
    }
}

var consoleHandler = function (parsedMessage) {
    logger.debug(parsedMessage.headers);
    logger.debug("text:", parsedMessage.text);
    logger.debug("html:", parsedMessage.html);
}

module.exports = {
    start: start, stop: stop, consoleHandler: consoleHandler, outbox: outbox
};

if (require.main === module) {
    start(consoleHandler, 2525);
}

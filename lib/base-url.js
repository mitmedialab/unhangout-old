var _ = require("underscore"),
    logger = require("./logging").getLogger();

module.exports = function(host, port, ssl) {
    var baseUrl = (ssl ? "https://" : "http://") + host;
    // Append the port if we're using a non-standard one.
    var nonStandardPort = ((ssl && port != 443) ||
        (!ssl && port != 80));
    if (nonStandardPort) {
        baseUrl += ":" + port;
    }
    return baseUrl;
};


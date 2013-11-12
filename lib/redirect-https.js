var http = require("http"),
    logger = require("./logging").getLogger(),
    express = require("express");

module.exports = function() {
    var redirect = express();
    var server = http.createServer(redirect);
    redirect.all("*", function(req, res) {
        logger.info("Redirecting HTTP to HTTPS: " + req.url);
        res.redirect("https://" + req.headers["host"] + req.url);
    });
    server.listen(80);
    logger.info("Started HTTP redirect server on 80");
};

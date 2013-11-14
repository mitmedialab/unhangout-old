var conf            = require("../conf.json"),
    unhangoutServer = require('../lib/unhangout-server'),
    seed            = require('../bin/seed.js'),
    path            = require("path"),
    redis           = require("redis").createClient(),
    _               = require('underscore'),
    async           = require('async'),
    webdriver       = require('selenium-webdriver'),
    sock_client     = require("sockjs-client"),
    SeleniumServer  = require('selenium-webdriver/remote').SeleniumServer;

var seleniumServer = null;
var buildBrowser = function(callback) {
    var browser = new webdriver.Builder().usingServer(
        seleniumServer.address()
    ).withCapabilities(
        webdriver.Capabilities.firefox()
    ).build();
    // Convenience methods for shorter typing for css selectors.
    browser.byCss = function(selector) {
        return browser.findElement(webdriver.By.css(selector));
    };
    browser.byCsss = function(selector) {
        return browser.findElements(webdriver.By.css(selector));
    };
    browser.byLinkText = function(linkText) {
        return browser.findElement(webdriver.By.linkText(linkText));
    };
    browser.mockAuthenticate = function(user) {
        return browser.executeScript("document.cookie = 'mock_user=" + user + "; path=/';");
    };
    callback(browser);
};

exports.getSeleniumBrowser = function(callback) {
    if (seleniumServer) {
        buildBrowser(callback);
    } else {
        var seleniumPath;
        if (!conf.TESTING_SELENIUM_PATH) {
            throw new Error("TESTING_SELENIUM_PATH not found in conf.json. " +
                            "Please specify path to selenium-server-standalone.jar.");
        }
        if (conf.TESTING_SELENIUM_PATH.substring(0, 1) == "/") {
            seleniumPath = conf.TESTING_SELENIUM_PATH;
        } else {
            seleniumPath = __dirname + "/../" + conf.TESTING_SELENIUM_PATH;
        }
        seleniumServer = new SeleniumServer(seleniumPath, {port: 4444});
        seleniumServer.start().then(function() { buildBrowser(callback) });
    }
}
exports.server = null;

exports.standardSetup = function(done) {
    exports.server = new unhangoutServer.UnhangoutServer();
    exports.server.on("inited", function() {exports.server.start()});
    exports.server.on("started", done);
    seed.run(1, redis, function() {
        exports.server.init({
            "GOOGLE_CLIENT_ID":true,
            "GOOGLE_CLIENT_SECRET":true,
            "REDIS_DB":1,
            "timeoutHttp":true,
            "mockAuth": true
        });
    });
};

var shutDown = function(server, done) {
    server.on("stopped", function() {
        server.on("destroyed", done);
        server.destroy();
    });
    server.stop();
};

exports.standardShutdown = function(done, s) {
    var servers = [];
    if (exports.server && exports.server.running) {
        servers.push(exports.server);
    }
    if (s && s.running) {
        servers.push(s);
    }
    async.map(servers, shutDown, function() {
        done();
             
    });
};

// Create a new socket, and authenticate it with the user specified in
// 'userKey', and join it to the given room. Depends on `exports.server`
// already being inited with users.
exports.authedSock = function(userKey, room, callback) {
    var newSock = sock_client.create("http://localhost:7777/sock");
    var user = exports.server.db.users.findWhere({"sock-key": userKey});
    var onData = function(message) {
        var msg = JSON.parse(message);
        if (msg.type === "auth-ack") {
            newSock.write(JSON.stringify({type: "join", args: {id: room}}));
        } else if (msg.type === "join-ack") {
            newSock.removeListener("data", onData);
            callback && callback(newSock);
        }
    };
    newSock.on("data", onData);
    newSock.on("error", function(msg) {
        // TODO: We're suppressing error messages here to make mocha happy.
        // See https://github.com/sockjs/sockjs-client-node/issues/1
        // Uncomment below to see the errors when running tests.
        //console.log("error", msg);
    });
    newSock.once("connection", function() {
        newSock.write(JSON.stringify({
            type:"auth",
            args:{ key: user.getSockKey(), id: user.id }
        }));
    });
};

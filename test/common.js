var conf            = require("../lib/options"),
    unhangoutServer = require('../lib/unhangout-server'),
    seed            = require('../bin/seed.js'),
    path            = require("path"),
    redis           = require("redis").createClient(),
    _               = require('underscore'),
    async           = require('async'),
    webdriver       = require('selenium-webdriver'),
    sock_client     = require("sockjs-client-ws"),
    SeleniumServer  = require('selenium-webdriver/remote').SeleniumServer,
    emailServer     = require("../bin/email-server.js"),
    Promise         = require("bluebird");

var TEST_CONF = _.extend({}, conf, {
    "UNHANGOUT_USE_SSL": false,
    "UNHANGOUT_GOOGLE_CLIENT_ID": true,
    "UNHANGOUT_GOOGLE_CLIENT_SECRET": true,
    "UNHANGOUT_HANGOUT_APP_ID": "rofl",
    "UNHANGOUT_REDIS_DB": 1,
    "mockAuth": true,
    "baseUrl": "http://localhost:7777"
});
TEST_CONF.UNHANGOUT_HANGOUT_ORIGIN_REGEX = TEST_CONF.baseUrl;

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
    browser.waitForSelector = function(selector) {
        return browser.wait(function() {
            return browser.byCsss(selector).then(function(els) {
                if (els.length == 0) {
                    return false;
                }
                try {
                    return els[0].isDisplayed();
                } catch (e) {
                    // catch stale reference errors.
                    return false;
                }
            });
        });
    };
    browser.waitForScript = function(exportName) {
        return browser.wait(function() {
            return browser.executeScript("return typeof " + exportName + " !== 'undefined';");
        });
    };
    // hack to get a promise... is there a better way?
    browser.then = function(cb) {
        return browser.executeScript("return true;").then(cb);
    };
    browser.waitTime = function(time) {
        var waited = false;
        return browser.wait(function() {
            setTimeout(function() { waited = true; }, time);
            return browser.then(function() { return waited; });
        });
    };
    browser.waitForFunc = function(cb) {
        return browser.wait(function() {
            return browser.then(function() { return cb(); })
        })
    };
    browser.manage().window().setSize(1024, 768).then(function() {
        callback(browser);
    });
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
// A list of all open connections to the HTTP server, which we can nuke to
// allow us to force-restart the server.

exports.standardSetup = function(done, skipSeed) {
    exports.server = new unhangoutServer.UnhangoutServer();
    exports.server.on("inited", function() {
        exports.server.start()
    });
    exports.server.on("started", function() {
        done();
        // This is a hack to allow us to kill the server while it still has
        // ongoing connections, without terminating the node process.  We use
        // this for simulating server restarts.
        // http://stackoverflow.com/a/14636625
        var OPEN_CONNS = [];
        exports.server.http.on('connection', function(socket) {
            OPEN_CONNS.push(socket);
            socket.on('close', function() {
                OPEN_CONNS.splice(OPEN_CONNS.indexOf(socket), 1);
            });
        });
        exports.server.on("stopping", function() {
            for (var i = 0; i < OPEN_CONNS.length; i++) {
                OPEN_CONNS[i].destroy();
            }
            OPEN_CONNS = [];
        });
    });
    if (!skipSeed) {
        seed.run(1, redis, function() {
            exports.server.init(TEST_CONF);
        });
    } else {
        exports.server.init(TEST_CONF);
    }
};
exports.startEmailServer = function(done) {
    exports.outbox = emailServer.outbox;
    emailServer.start(function(){}, conf.UNHANGOUT_SMTP.port, done);
};
exports.stopEmailServer = function(done) {
    emailServer.stop(done);
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
exports.restartServer = function(onStopped, onRestarted) {
    exports.standardShutdown(function() {
        onStopped(function() {
            exports.standardSetup(onRestarted, true);
        });
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
        console.log("error", msg);
    });
    newSock.once("connection", function() {
        newSock.write(JSON.stringify({
            type:"auth",
            args:{ key: user.getSockKey(), id: user.id }
        }));
    });
};

// Params:
// @param {Function} fn A test function.
// @param {Number} [timeout=100] milliseconds between repeated executions of fn
//
// Repeatedly call `fn` to test whether to proceed.  Returns a promise which is
// fulfilled when executing `fn` returns a truthy value.  `fn` may also return
// a promise which, when fulfilled, is checked for a truthy value.
exports.await = function(fn, timeout) {
    timeout = timeout || 100;
    return new Promise(function(resolve, reject) {
        function go() {
            function loop(res) {
                res ? resolve(res) : setTimeout(go, timeout);
            }
            try {
                var result = fn();
            } catch (err) {
                return reject(err);
            }
            // Check if `result` is a promise.  (Is there a better way?)
            if (typeof result === "object" && result.then && typeof result.then === "function") {
                result.then(loop).catch(function(err) { reject(err); });
            } else {
                loop(result);
            }
        }
        go();
    });
};

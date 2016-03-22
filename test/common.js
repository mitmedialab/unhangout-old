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
    "UNHANGOUT_PORT": 7778,
    "mockAuth": true,
    "baseUrl": "http://localhost:7778"
});

exports.URL = TEST_CONF.baseUrl;
exports.FAST_URL = TEST_CONF.baseUrl + "/public/html/test.html"
exports.PORT = TEST_CONF.UNHANGOUT_PORT;

TEST_CONF.UNHANGOUT_HANGOUT_ORIGIN_REGEX = TEST_CONF.baseUrl;

// Get a reference to the native nodejs timers so we can work around resetting
// problems with sinon.
var nativeTimers = {
  setTimeout: setTimeout, clearTimeout: clearTimeout, Date: Date
};
exports.restoreTimers = function() {
  _.extend(global, nativeTimers);
}

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
    browser.selectOption = function(selector, text) {
        // Can't seem to find any implementation of
        // https://selenium.googlecode.com/git-history/selenium-2.37.0/docs/api/py/webdriver_support/selenium.webdriver.support.select.html
        // for javascript.
        return browser.executeScript([
            "return (function() {",
                "var options = document.querySelectorAll('" + selector + " option');",
                "for (var i = 0; i < options.length; i++) { ",
                    "if (options[i].innerHTML.trim() == '" + text + "') {",
                        "options[i].selected = true;",
                        "return true;",
                    "}",
                "};",
                "return false;",
            "})();"].join(""));
    };
    browser.mockAuthenticate = function(user) {
        browser.get(exports.FAST_URL);
        return browser.executeScript("document.cookie = 'mock_user=" + user + "; path=/';");
    };
    browser.unMockAuthenticate = function(user) {
        browser.get(exports.FAST_URL);
        return browser.executeScript("document.cookie = 'mock_user=; path=/';");
    };
    browser.awaitModalDismissal = function(selector) {
      return browser.wait(webdriver.until.elementIsNotVisible(
          browser.findElement(webdriver.By.css(selector || ".modal")))
      );
    };
    // This is sugar to wrap selenium's `wait` with a default timeout.  We want
    // to throw exceptions rather than waiting for mocha's timeout so that we
    // can see a stack trace (mocha's timeous don't provide one).
    browser.waitWithTimeout = function(cb, timeout) {
        var start = new Date().getTime();
        timeout = timeout || 30000;
        return browser.wait(function() {
            if (new Date().getTime() - start > timeout) {
                throw new Error("Browser wait timeout of " + timeout + " exceeded.");
            }
            return cb();
        });
    };
    browser.waitForSelector = function(selector, timeout) {
        timeout = timeout || 30000;
        return browser.waitWithTimeout(function() {
            return browser.byCss(selector).then(function(el) {
                return el.isDisplayed();
            }).then(null, function(err) {
                return false;
            });
        }, timeout).then(null, function(err) {
          if (/^Browser wait timeout of \d+ exceeded.$/.test(err.message)) {
            throw new Error("Selector '" + selector + "' not found after " + timeout + "ms.");
          }
          throw err;
        });
    };
    browser.waitForScript = function(exportName) {
        return browser.waitWithTimeout(function() {
            return browser.executeScript("return typeof " + exportName + " !== 'undefined';");
        });
    };
    browser.then = function(cb) {
        // This uses a private property of the browser to access the current
        // control flow of the "manager" (see
        // https://code.google.com/p/selenium/wiki/WebDriverJs#Control_Flows).
        // There doesn't seem to be a public method to access this the "public"
        // interface to get a control flow (which is probably the browser's
        // flow, but not necessarily) is:
        //
        //      require("selenium-webdriver").promise.controlFlow()
        return browser.flow_.execute(cb);
    };
    browser.waitTime = function(time) {
        return browser.then(function() {
            var sentinel = false;
            setTimeout(function() { sentinel = true; }, time);
            return browser.wait(function() {
                return sentinel;
            });
        });
    };
    browser.waitForFunc = function(cb) {
        return browser.waitWithTimeout(function() {
            return browser.then(function() { return cb(); })
        })
    };

    browser.waitForEventReady = function(event, sockKey, timeout) {
        // Fulfill a promise when the event page has fully loaded -- socket
      // connected etc.  This is well after document.ready and often after
      // selenium fulfills the "get" request for the event page.
        return browser.waitWithTimeout(function() {
            return browser.executeScript(
                "return !!window._JOIN_INITIALIZED;"
            ).then(function(joinReady) {
                if (joinReady && event && sockKey) {
                    return !!event.get("connectedUsers").findWhere({"sock-key": sockKey});
                } else if (joinReady && event) {
                    return event.get("connectedUsers").length >= 1;
                } else {
                    return joinReady;
                }
            });
        }, timeout);
    };

    browser.waitForHangoutReady = function(session, sockKey, timeout) {
        return browser.waitWithTimeout(function() {
            return browser.executeScript(
                "return document.getElementsByTagName('iframe')[0].contentWindow" +
                    ".document.getElementsByTagName('iframe')[0].contentWindow" +
                    ".FACILITATOR_LOADED === true;"
            ).then(function(hangoutReady) {
                var user = exports.server.db.users.findWhere({"sock-key": sockKey});
                if (hangoutReady && session && sockKey) {
                    return !!_.findWhere(session.get("connectedParticipants"), {
                        "id": user.id
                    });
                } else if (hangoutReady && session) {
                    return session.getNumConnectedParticipants() >= 1;
                } else {
                    return hangoutReady;
                }
            }).then(null, function(err) {
                // catch script errors.
                return false;
            });
        }, timeout);
    };

    browser.manage().window().setSize(1024, 768).then(function() {
        callback(browser);
    });

    browser.saveScreenshot = function(suffix) {
      return browser.takeScreenshot().then(function(image, err) {
        var name = "logs/" + Date.now() + suffix + ".png";
        require('fs').writeFile(name, image, 'base64', function(err) {
          if (err) {
            console.log(err);
            throw err;
          }
        });
      });
    }
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
        var opts = {port: 4444};
        if (conf.TESTING_SELENIUM_VERBOSE) {
            opts.stdio = "inherit"; // enable verbose logging
        }
        if (conf.TESTING_FIREFOX_BIN) {
            opts.jvmArgs = ["-Dwebdriver.firefox.bin=" + conf.TESTING_FIREFOX_BIN];
        }
        seleniumServer = new SeleniumServer(seleniumPath, opts);
        var isStarted = false;
        // Set the timeout to something less than a multiple of the timeout set
        // in test startups, so we get as many start up retries as we can
        // before a timeout.
        seleniumServer.start(59000).then(function() {
            isStarted = true;
            buildBrowser(callback);
        }).then(null, function(err) {
          if (!isStarted) {
            console.log("Error starting selenium, retrying.  ", err);
            seleniumServer = null;
          } else {
            console.log("Error thrown by buildBrowser; retrying.", err);
          }
          exports.getSeleniumBrowser(callback);
        });
    }
};

exports.stopSeleniumServer = function() {
    if (!seleniumServer) {
        return { then: function(cb) { cb(); }}
    } else {
        return seleniumServer.stop().then(function() {
            seleniumServer = null;
        });
    }
};

exports.seedDatabase = function(cb) {
    seed.run(1, redis, cb);
};

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
        exports.seedDatabase(function() {
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
exports.recipientify = function(email) {
    return {address: email, name: ''}
}


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

exports.sockWithPromiseClose = function() {
    var sock = sock_client.create(exports.URL + "/sock");
    sock.promiseClose = function() {
        var promise = new Promise(function(resolve, reject) {
            sock.once("close", function() { resolve() });
            sock.once("error", function(err) { reject(err) });
        });
        sock.close();
        return promise;
    };
    return sock;
};

// Create a new socket, and authenticate it with the user specified in
// 'userKey', and join it to the given room. Depends on `exports.server`
// already being inited with users.
exports.authedSock = function(userKey, room, callback) {
    return new Promise(function(resolve, reject) {
        var newSock = exports.sockWithPromiseClose();
        var user = exports.server.db.users.findWhere({"sock-key": userKey});
        var onData = function(message) {
            var msg = JSON.parse(message);
            if (msg.type === "auth-ack") {
                newSock.write(JSON.stringify({type: "join", args: {id: room}}));
            } else if (msg.type === "join-ack") {
                newSock.removeListener("data", onData);
                callback && callback(newSock);
                resolve(newSock);
            }
        };
        newSock.on("data", onData);
        newSock.on("error", function(msg) {
            console.log("socket error", msg);
            reject(new Error(msg));
        });
        newSock.once("connection", function() {
            newSock.write(JSON.stringify({
                type:"auth",
                args:{ key: user.getSockKey(), id: user.id }
            }));
        });
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

// Set up the event with history and user profile settings for testing followup
// emails
exports.prepareFollowupEventAndUsers = function(event, users) {
    users = users || {};
    var session = event.get("sessions").at(0);
    var session2 = event.get("sessions").at(1);
    session.set("approved", true);
    session2.set("approved", true);

    users.noShare = exports.server.db.users.get(0);
    users.noShare.set({
        displayName: "NoShareUser",
        picture: "http://pldb.media.mit.edu/face/srishti",
        preferredContact: {
            noShare: true,
            emailInfo: "dontshareme@example.com",
            twitterHandle: "dontshareme",
            linkedinURL: "http://linkedin/dontshareme"
        }
    });

    users.emailOnly = exports.server.db.users.get(1);
    users.emailOnly.set({
        displayName: "EmailOnlyUser",
        picture: "https://lh3.googleusercontent.com/-OP7MAxbSCvs/AAAAAAAAAAI/AAAAAAAAAEA/js2MqRDWiJk/photo.jpg",
        preferredContact: {
            emailInfo: "unhangout.developer@gmail.com",
        }
    });

    users.emailAndTwitter = exports.server.db.users.get(2);
    users.emailAndTwitter.set({ 
        displayName: "EmailAndTwitterUser",
        picture: "http://lh4.googleusercontent.com/-8NHi4O5-AF0/AAAAAAAAAAI/AAAAAAAAAAA/8kJJNYEwztM/s32-c/photo.jpg",
        preferredContact: {
            emailInfo: "jules.schmulz@gmail.com",
            twitterHandle: "JulesSchmulz",
        }
    });

    users.linkedInOnly = exports.server.db.users.get(3);
    users.linkedInOnly.set({
        displayName: "LinkedInOnlyUser",
        preferredContact: {
            linkedinURL: "https://www.linkeedin.com/doesanyonereallyusethis"
        }
    });

    users.superuser1 = exports.server.db.users.findWhere({"sock-key": "superuser1"});

    // Set up event history such that users shared sessions with each other.
    var history = {event: {}, sessions: {}};
    history.event[users.noShare.id] = {start: 0, total: 1000};
    history.event[users.emailOnly.id] = {start: 0, total: 1000};
    history.event[users.emailAndTwitter.id] = {start: 0, total: 1000};
    history.event[users.linkedInOnly.id] = {start: 0, total: 1000};
    history.event[users.superuser1.id] = {start: 0, total: 1000};
    var sessHist = history.sessions[session.id] = {};
    sessHist[users.noShare.id] = {start: 0, total: 2345};
    sessHist[users.emailOnly.id] = {start: 0, total: 2345};
    sessHist[users.linkedInOnly.id] = {start: 0, total: 2345};
    var sessHist2 = history.sessions[session2.id] = {};
    sessHist[users.emailAndTwitter.id] = {start: 0, total: 2345};
    sessHist[users.noShare.id] = {start: 0, total: 2345};

    event.set("history", history);
    return users;
};

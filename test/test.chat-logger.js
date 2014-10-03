var fs = require("fs"),
    path = require("path"),
    sinon = require("sinon"),
    expect = require("expect.js"),
    models = require("../lib/server-models"),
    chatLogger = require("../lib/chat-logger"),
    common = require("./common"),
    Promise = require("bluebird"),
    _ = require("underscore");

describe("CHAT LOGGER", function() {
    this.timeout(16000); // Give a little extra time in case travis is bogged down.
    var event, user;
    // Resolve expectedFile to look like we're coming from inside ../lib/
    // instead of inside ../test/, so we can compare it to the version that
    // ../lib/chat-logger.
    var expectedFile = path.join(__dirname, "/../lib") + "/../public/logs/chat/test.txt";

    function closeAllOpenStreams() {
        _.each(chatLogger._queues.openStreams, function(stream, filename) {
            stream.end(null, 'utf8');
            delete chatLogger._queues.openStreams[filename];
            delete chatLogger._queues.closingStreams[filename];
        });
    }

    function removeChatLog() {
        return new Promise(function(resolve, reject) {
            fs.exists(expectedFile, function(exists) {
                if (exists) {
                    fs.unlink(expectedFile, resolve);
                } else {
                    resolve();
                }
            });
        });
    }

    function getFileContents(filename) {
        return new Promise(function(resolve, reject) {
            fs.readFile(filename, {encoding: 'utf8'}, function(err, txt) {
                if (err && err.code == 'ENOENT') {
                    resolve(null);
                } else if (err) {
                    reject(err);
                } else {
                    resolve(txt);
                }
            });
        });

    }

    beforeEach(function(done) {
        event = new models.ServerEvent({id: "test", timeZoneValue: "America/Denver"});
        user = new models.ServerUser({
            displayName: "Testy McTester",
        });
        // Close any streams that may have been opened by other tests.
        closeAllOpenStreams();
        removeChatLog().then(done);
    });
    afterEach(function(done) {
        removeChatLog().then(done);
    });

    it("Logs chats to file", function(done) {
        event.logChat(new models.ServerChatMessage({
            user: user,
            text: "This is mah message"
        }));
        event.logChat(new models.ServerChatMessage({
            user: user,
            text: "This is a second"
        }));
        var dateFmt = moment(new Date().getTime()).tz('America/Denver').format(
            "YYYY MMM D h:mm:ss[]a");
        common.await(function() {
            return getFileContents(expectedFile).then(function(txt) {
                return txt === (
                        dateFmt + " Testy M: This is mah message\n" +
                        dateFmt + " Testy M: This is a second\n"
                );
            });
        }).then(function() {
            // We have a reference to an open stream..
            expect(Object.keys(chatLogger._queues.openStreams)).to.eql(
                [expectedFile]);
            // ... and a reference to its timeout for closing.
            expect(Object.keys(chatLogger._queues.closingStreams)).to.eql(
                [expectedFile]);

            // Close the stream "eventually".
            var clock = sinon.useFakeTimers(0, "setTimeout", "clearTimeout", "Date");
            chatLogger._queues.openStreams[expectedFile].closeEventually();
            clock.tick(10000 + 1);
            clock.restore();

            expect(chatLogger._queues.openStreams[expectedFile]).to.be(undefined);
            expect(chatLogger._queues.closingStreams[expectedFile]).to.be(undefined);
            expect(chatLogger._queues.pendingStreams[expectedFile]).to.be(undefined);
            expect(chatLogger._queues.streamResolutionQueue[expectedFile]).to.be(undefined);

            done();
        }).catch(function(err) {
            done(err);
        });
    });

    it("Opens existing chat log in append mode", function(done) {
        fs.writeFile(expectedFile, "Starting data\n", {encoding: 'utf8'}, function(err) {
            expect(err).to.be(null);
            getFileContents(expectedFile).then(function(txt) {
                expect(txt).to.be("Starting data\n");
            }).then(function() {
                event.logChat(new models.ServerChatMessage({
                    user: user, text: "Second line"
                }));
                var dateFmt = moment(new Date().getTime()).tz('America/Denver').format(
                    "YYYY MMM D h:mm:ss[]a");
                return common.await(function() {
                    return getFileContents(expectedFile).then(function(txt) {
                        return txt === "Starting data\n" + dateFmt + " Testy M: Second line\n";
                    });
                });
            }).then(function() {
                done();
            }).catch(function(e) {
                done(e);
            });
        });
    });
});

var fs = require("fs"),
    expect = require("expect.js"),
    models = require("../lib/server-models"),
    common = require("./common"),
    Promise = require("bluebird");

describe("CHAT LOGGER", function() {
    var event, user;
    var expectedFile = __dirname + "/../public/logs/chat/test.txt"; 

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
                return getFileContents(expectedFile);
            }).then(function(txt) {
                var dateFmt = moment(new Date().getTime()).tz('America/Denver').format(
                    "YYYY MMM D h:mm:ss[]a");
                expect(txt).to.be(
                    "Starting data\n" +
                    dateFmt + " Testy M: Second line\n")
                done();
            }).catch(function(e) {
                done(e);
            });
        });
    });
});

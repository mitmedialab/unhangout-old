var server = require('../lib/unhangout-server'),
    models = require("../lib/server-models"),
	expect = require('expect.js'),
	_ = require('underscore')._,
	request = require('superagent'),
	seed = require('../bin/seed.js'),
    common = require("./common");

describe('PERMALINKS', function(){
    beforeEach(function(done) {
        common.standardSetup(function() {
            var pms = new models.ServerSession({
                isPermalinkSession: true,
                shortCode: "test"
            });
            common.server.db.permalinkSessions.add(pms);
            done();
        });
    });
    afterEach(common.standardShutdown);

    it("should require authentication for permalinks", function(done) {
        request.get('http://localhost:7777/h/')
            .redirects(0)
            .end(function(res){
                expect(res.status).to.be(302);
                expect(res.headers.location).to.be("/auth/google");
                done();
            });
    });
    it("should require authentication for permalink details", function(done) {
        request.get('http://localhost:7777/h/test')
            .redirects(0)
            .end(function(res){
                expect(res.status).to.be(302);
                expect(res.headers.location).to.be("/auth/google");
                done();
            });
    });
    it('should direct to the landing page when there is no code', function(done){
        request.get('http://localhost:7777/h/')
            .set("x-mock-user", "regular1")
            .end(function(res){
                expect(res.status).to.be(200);
                done();
            });
    });

    it('if :code is new, it should create a new session on the server', function(done){
        request.get('http://localhost:7777/h/new-test')
            .set("x-mock-user", "regular1")
            .redirects(0)
            .end(function(res){
                expect(res.status).to.be(302);
                expect(res.headers.location.indexOf("/h/admin/new-test")).to.be(0);
                expect(common.server.db.permalinkSessions.findWhere({
                    shortCode: "new-test"
                })).to.not.eql(undefined);
                done();
            });
    });

    it('if :code is active, multiple requests only create one session', function(done){
        request.get('http://localhost:7777/h/test2')
            .set("x-mock-user", "regular1")
            .redirects(0)
            .end(function(res){
                expect(res.status).to.be(302);
                expect(res.headers.location.indexOf("/h/admin/test2")).to.be(0);
                var length = common.server.db.permalinkSessions.length;
                request.get('http://localhost:7777/h/test2')
                    .set("x-mock-user", "regular1")
                    .end(function(res){
                        expect(res.status).to.be(200);
                        expect(common.server.db.permalinkSessions.length).to.be(length);
                        done();
                    });
            });
    });

    it('if :code is new, it should present the form only for first visitor', function(done){
        request.get('http://localhost:7777/h/test2')
            .set("x-mock-user", "regular1")
            .end(function(res){
                expect(res.text.indexOf('<input')).to.not.eql(-1);
                request.get('http://localhost:7777/h/test2')
                    .set("x-mock-user", "regular1")
                    .end(function(res){
                        expect(res.text.indexOf('<input')).to.be(-1);
                        done();
                    });
            });
    });

    it('should reject requests without a valid creation key in the request body', function(done){
        var session = common.server.db.permalinkSessions[0];
        request.post('http://localhost:7777/h/admin/test')
            .set("x-mock-user", "regular1")
            .send({creationKey: 'wrong1', title: 'migrate title', description: 'something cool'})
            .end(function(res){
                expect(res.status).to.be(403);
                done();
            });
    });

    it('should update session title and description when valid creation key is present', function(done){
        var session = common.server.db.permalinkSessions.at(0);
        request.post('http://localhost:7777/h/admin/test')
            .set("x-mock-user", "regular1")
            .send({creationKey: session.get('creationKey'), title: 'migrate title', description: 'something cool'})
            .end(function(res){
                expect(res.status).to.be(200);
                expect(session.get('title')).to.be('migrate title');
                expect(session.get('description')).to.be('something cool');
                done();
            });
    });
});

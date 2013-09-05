var models = require('./server-models.js');

// drawn from http://hackerpreneurialism.com/post/48344246498/node-js-testing-mocking-authenticated-passport-js#sthash.qJ6lzTnq.dpuf

var curMockUser = null;

module.exports = {

	initialize: function(sessionUserObject) {
		return function(req, res, next) {
			passport = this;
			passport._key = 'passport';
			passport._userProperty = 'user';

			curMockUser = new models.ServerUser(sessionUserObject);

			passport.serializeUser = function(user, done) {
				done(null, curMockUser);
			}

			passport.deserializeUser = function(user, done) {
				done(null, curMockUser);
			}

			req._passport = {instance: passport};
			req._passport.session = {user: curMockUser};
			next();
		};
	},
	
	getMockUser: function() {
		return curMockUser;
	},

	baseMockUser: {name: {givenName:"Drew", familyName:"Harry"}, displayName:"Drew Harry (mock)", id:"0"}
};

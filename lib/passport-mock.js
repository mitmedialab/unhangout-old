var models = require('../public/js/models.js');

// drawn from http://hackerpreneurialism.com/post/48344246498/node-js-testing-mocking-authenticated-passport-js#sthash.qJ6lzTnq.dpuf

module.exports = {
	initialize: function(sessionUserObject) {
		return function(req, res, next) {
			passport = this;
			passport._key = 'passport';
			passport._userProperty = 'user';
			passport.serializeUser = function(user, done) {
				var userObj = new models.User(user);
				done(null, userObj);
			}
			passport.deserializeUser = function(user, done) {
				var userObj = new models.User(user);
				
				done(null, userObj);
			}

			req._passport = {instance: passport};
			req._passport.session = {user: sessionUserObject};
			next();
		};
	},
	
	mockUser: {name: {givenName:"Drew", familyName:"Harry"}, displayName:"Drew Harry (mock)", id:"0"}
};

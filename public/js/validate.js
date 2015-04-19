(function (name, definition) {

// This is include-able both in a browser environment and in a v8/node env, so
// it needs to figure out which situation it is in. If it's on the server, put
// everything in exports and behave like a module. If it's on the client, use
// requirejs styling.  Either way, make sure a 'define' method is available to
// wrap our call in.

if (typeof module !== 'undefined') module.exports = definition();
else if (typeof define === 'function' && typeof define.amd === 'object') define(definition);
else this[name] = definition();

})('validate', function() {

	var exp = {};

	exp.twitterRegEx = /^@?(\w+)$/;

  exp.emailRegEx =  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

  exp.linkedInRegEx = /^(http(s)?:\/\/)?([\w]+\.)?linkedin\.com\/(pub|in|profile)\/.+/gm;

  exp.validateEmail = function(email) {
      return !!(email && email.match(exp.emailRegEx));
  };

  exp.validateTwitterHandle = function(twitterHandle) {
      return !!(twitterHandle && twitterHandle.match(exp.twitterRegEx));
  };

  exp.validateLinkedIn = function(linkedinURL) {
      return !!(linkedinURL && linkedinURL.match(exp.linkedInRegEx));
  };

  exp.preferredContact = function(obj) {
      if (obj.linkedinURL && !exp.validateLinkedIn(obj.linkedinURL)) {
          return false;
      }
      if (obj.twitterHandle && !exp.validateTwitterHandle(obj.twitterHandle)) {
          return false;
      }
      if (obj.emailInfo && !exp.validateEmail(obj.emailInfo)) {
          return false;
      }
      if (!obj.linkedinURL && !obj.twitterHandle && !obj.emailInfo && obj.noShare !== true) {
          return false;
      }
      return true;
  };

	return exp;
});

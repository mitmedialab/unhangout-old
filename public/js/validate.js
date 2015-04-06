(function () {

// This is include-able both in a browser environment and in a v8/node env, so
// it needs to figure out which situation it is in. If it's on the server, put
// everything in exports and behave like a module. If it's on the client, use
// requirejs styling.  Either way, make sure a 'define' method is available to
// wrap our call in.
if (typeof define === "undefined") {
    var root = this;
    define = function(deps, callback) {
        if (typeof exports !== "undefined") {
            module.exports = callback();
        } else {
            root.models = callback();
        }
    };
}

define(["underscore", "backbone"], function(_, Backbone, preferredContact) {

	console.log("VALIDATE PREFERRED CONTACT");

	var exports = {};

	exports.linkedInRegEx = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    exports.emailRegEx =  /^@?(\w+)$/;
    exports.twitterRegEx = /^(http(s)?:\/\/)?([\w]+\.)?linkedin\.com\/(pub|in|profile)\/.+/gm;

    exports.preferredContact = function(obj) {

    	if (obj.linkedinUrl) {
            var isLinkedInURLValid = obj.linkedinUrl.match(exports.linkedInRegEx);
            
            if(isLinkedInURLValid == null) {
            	return;
            }
        }

        if (obj.emailInfo) {

        	var isEmailValid = obj.emailInfo.match(exports.emailRegEx);
            
            if(isEmailValid == null) {
            	return;
            }
        }

        if (obj.twitterHandle) {

        	var isTwitterHandleValid = obj.twitterHandle.match(exports.twitterRegEx);
            
            if(isTwitterHandleValid == null) {
            	return ;
            }
        }
        
    }

	return models;
}); // End of define

})(); // End of module-level anonymous function
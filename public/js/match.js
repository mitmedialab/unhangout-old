(function (name, definition) {

// This is include-able both in a browser environment and in a v8/node env, so
// it needs to figure out which situation it is in. If it's on the server, put
// everything in exports and behave like a module. If it's on the client, use
// requirejs styling.  Either way, make sure a 'define' method is available to
// wrap our call in.

if (typeof module !== 'undefined') module.exports = definition();
else if (typeof define === 'function' && typeof define.amd === 'object') define(definition);
else this[name] = definition();

})('match', function() {

	var exp = {};

  exp.atMessages = function(string) {

    var regex = /@([a-zA-Z0-9]+)/g; 

    if (!regex.global) {
      throw new Error("RegEx must have global flag to use matchAll");
    }
    
    var match = null;
    var matches = [];
    
    while (match = regex.exec(string)) {
      matches.push(match);
    }

    return matches;
    
  };

  exp.normalize = function(name) {
    return name.replace(/\s/g, "").toLowerCase();
  };

  exp.quoteRegExp = function(pattern) {
    return pattern.replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1");
  };

  exp.replaceAtName = function(msg, atname, replacement) {
    return msg.replace(new RegExp("(" + this.quoteRegExp(atname) + ")", "gi"),
                           replacement);
  };

	return exp;
});

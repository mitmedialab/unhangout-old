(function (name, definition) {

// This is include-able both in a browser environment and in a v8/node env, so
// it needs to figure out which situation it is in. If it's on the server, put
// everything in exports and behave like a module. If it's on the client, use
// requirejs styling.  Either way, make sure a 'define' method is available to
// wrap our call in.

if (typeof module !== 'undefined') module.exports = definition();
else if (typeof define === 'function' && typeof define.amd === 'object') define(definition);
else this[name] = definition();

})('atname', function() {

	var exp = {};
  exp.atRegEx = /(@[a-zA-Z0-9]+)/g; 
  if (!exp.atRegEx.global) {
    throw new Error("RegEx must have global flag to use matchAll");
  }

  exp.splitByAtNames = function(string) {
    var parts = string.split(exp.atRegEx);
    return parts;
  };

  exp.mapAtNames = function(string, users, func) {
    var parts = exp.splitByAtNames(string);
    return parts.map(function(part, i) {
      // regex.split with a single matching group always puts the matching
      // group in odd-numbered array elements.
      // "@name stuff" will split as ["", "@name", " stuff"].
      if (i % 2 == 1) {
        var norm = exp.normalize(part.substring(1, part.length));
        var mentioned = users.find(function(user) {
          return exp.normalize(user.get("displayName")).indexOf(norm) === 0;
        });
        return func(part, mentioned || null);
      }
      return func(part, null);
    });
  };

  exp.normalize = function(name) {
    return name.replace(/\s/g, "").toLowerCase();
  };

  exp.quoteRegExp = function(pattern) {
    return pattern.replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1");
  };

  exp.replaceAtName = function(msg, name, replacement) {
    return msg.replace(new RegExp("(" + this.quoteRegExp(name) + ")", "gi"),
                           replacement);
  };

	return exp;
});

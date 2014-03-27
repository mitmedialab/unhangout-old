var    _ = require("underscore"),
    path = require("path"),
    conf = require("../public/js/requirejs-config.json"),
    requirejsMiddleware = require("requirejs-middleware");

var BASE = __dirname + "/.."

function wrapScript(url) {
    return "<script type='text/javascript' src='" + url + "'></script>";
}

module.exports = {
    // Function to use in templates to return the appropriate dev or production
    // script tags for a given required script.  Call with any number of
    // scripts to load as arguments.
    requireScripts: function() {
        if (process.env.NODE_ENV === "production") {
            // Return script paths to ``buildUrl``, which contains optimized
            // builds (either build with middleware or manually).
            var urls = _.map(arguments, function(script) {
               var rel = path.relative(conf.baseUrl, script);
               return path.join(conf.buildUrl, rel);
            });
            return _.map(urls, wrapScript).join("\n");
        } else {
            var out = [wrapScript("/public/vendor/require.js")];
            out.push("<script type='text/javascript'>requirejs.config(" + JSON.stringify(conf) + ");</script>")
            out = out.concat(_.map(arguments, wrapScript));
            return out.join("\n");
        }
    }
};

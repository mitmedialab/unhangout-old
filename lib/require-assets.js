var    _ = require("underscore"),
    path = require("path"),
    conf = require("../public/js/requirejs-config.json"),
    requirejsMiddleware = require("requirejs-middleware");

var BASE = __dirname + "/.."

function wrapScript(url) {
    return "<script type='text/javascript' src='" + url + "'></script>";
}

module.exports = {
    // Configuration of requirejs-middleware (https://github.com/jbuck/requirejs-middleware)
    // for use in our setup.
    middleware: function(is_production, callback) {
        if (_.isUndefined(is_production)) {
            is_production = process.env.NODE_ENV === "production";
        }
        return requirejsMiddleware({
            src: path.join(BASE, conf.baseUrl),
            dest: path.join(BASE, conf.buildUrl),
            build: is_production,
            debug: is_production && process.env.NODE_ENV !== "testing",
            once: is_production,
            // Ugly hack for baseUrl: to avoid duplication, we're using the
            // same default conf for optimization (which compiles using r.js
            // under the hood) and for running require.js in development.  For
            // the `baseUrl` property, r.js expects a *path* relative to
            // project root, but require.js conf expects an absolute *URL*.
            // Remove initial slash from conf to work with the optimizer here.
            defaults: _.extend({}, conf, {
                baseUrl: conf.baseUrl.substring(1),
                // Clear 'modules' property to avoid infinite loop
                modules: undefined
            }),
            // Keeping module definitions in the JSON as well so that
            // client-side scripts are all defined in one place.
            modules: conf.modules
        }, callback);
    },
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

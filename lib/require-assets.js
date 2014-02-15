var    _ = require("underscore"),
    path = require("path"),
    conf = require("../public/js/requirejs-config.json"),
    requirejsMiddleware = require("requirejs-middleware");

var BASE = __dirname + "/.."
var IS_PRODUCTION = process.env.NODE_ENV === "production";

function wrapScript(url) {
    return "<script type='text/javascript' src='" + url + "'></script>";
}

module.exports = {
    // Configuration of requirejs-middleware (https://github.com/jbuck/requirejs-middleware)
    // for use in our setup.
    middleware: function() {
        return requirejsMiddleware({
            src: path.join(BASE, conf.baseUrl),
            dest: path.join(BASE, conf.buildUrl),
            build: IS_PRODUCTION,
            debug: IS_PRODUCTION,
            once: IS_PRODUCTION,
            // Ugly hack for baseUrl: r.js expects a relative path to project
            // root, but require.js conf expects an absolute URL.
            defaults: _.extend({}, conf, {baseUrl: conf.baseUrl.substring(1)}),
            modules: {
                "index.js": { include: "index" }
            }
        });
    },
    // Function to use in templates to return the appropriate dev or production
    // script tags for a given required script.  Call with any number of
    // scripts to load as arguments.
    requireScripts: function() {
        if (IS_PRODUCTION) {
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

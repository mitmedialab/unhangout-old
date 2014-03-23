#!/usr/bin/env node
// Using our configuration for requirejs, compile all assets for use in
// production.  This MUST be run after every change to assets in production --
// the production server assumes the assets are there.

var path = require("path"),
      fs = require("fs"),
       _ = require("underscore"),
    Promise = require("bluebird"),
    stylus = require("stylus"),
    requirejsMiddleware = require("requirejs-middleware"),
    nib = require("nib"),
    conf = require("../public/js/requirejs-config.json"),
    logger = require("../lib/logging").getLogger();

var BASE = __dirname + "/..";

function compileJS() {
    // Compile and optimize all javascript, making use of `requirejsMiddleware`
    // to do it.  When running in "once" mode, requirejsMiddleware acts
    // basically as a // singleton function.
    // See https://github.com/jbuck/requirejs-middleware

    // Set up a count for callbacks we're expecting, to ensure everything got
    // compiled properly.
    var count = Object.keys(conf.modules).length;
    var rejected = false;
    return new Promise(function(resolve, reject) {
        requirejsMiddleware({
            src: path.join(BASE, conf.baseUrl),
            dest: path.join(BASE, conf.buildUrl),
            debug: process.env.NODE_ENV !== "testing",
            once: true,
            defaults: _.extend({}, conf, {
                // Ugly hack for baseUrl: to avoid duplication, we're using the
                // same default conf for optimization (which compiles using r.js
                // under the hood) and for running require.js in development.  For
                // the `baseUrl` property, r.js expects a *path* relative to
                // project root, but require.js conf expects an absolute *URL*.
                // Remove initial slash from conf to work with the optimizer here.
                baseUrl: conf.baseUrl.substring(1),
                // Clear 'modules' property to avoid infinite loop
                modules: undefined
            }),
            modules: conf.modules
        }, function(err) {
            if (err && !rejected) {
                rejected = true;
                reject(err);
            } else {
                count--;
                if (count === 0) {
                    resolve();
                }
            }
        });
    });
}
function compileStylusFile(filename) {
    // Compile a single stylus file. Saves .css file adjacent to .styl file.
    logger.debug("Compiling " + filename);
    return Promise.promisify(fs.readFile)(filename, {encoding: 'utf8'})
        .then(function(data) {
            return new Promise(function(resolve, reject) {
                stylus(data)
                    .set("filename", filename)
                    .set("paths", [nib.path, path.dirname(filename)])
                    .import('nib')
                    .render(function(err, css) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(css);
                        }
                    });
            });
        }).then(function(css) {
            var cssFilename = path.join(
                path.dirname(filename),
                path.basename(filename, ".styl") + ".css"
            );
            logger.debug("Writing " + cssFilename);
            return Promise.promisify(fs.writeFile)(cssFilename, css);
        });
}

function compileAllStylus(folder) {
    // Compile all stylus files in the given folder, saving .css files adjacent
    // to .styl files.  In development mode, this is done by stylus middleware
    // -- but in production we intercept static routes before they ever get to
    // node, so we need to compile them manually.
    return Promise.promisify(fs.readdir)(folder).then(function(files) {
        // Filter for .styl files...
        var styl = _.filter(files, function(file) { return path.extname(file) === ".styl"; });
        // add folder names.
        var styl = _.map(styl, function(file) { return path.join(folder, file); });
        return Promise.map(styl, compileStylusFile);
    });
}

function compile() {
    return Promise.all([
       compileJS(),
       compileAllStylus(__dirname + "/../public/css")
    ]);
}

module.exports.compile = compile;

if (require.main === module) {
    compile().catch(function(err) {
        logger.error(err);
        process.exit(1);
    });
}

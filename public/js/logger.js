/*
 Simple logger.  Usage:

var logger = new logger.Logger("prefix", "info");

Logging levels (most verbose -> least):
     "debug", "log", "info", "error"
*/

define(function() {

var Logger = function(prefix, level) {
    level = level || "debug";

    // Ensure console exists and has necessary properties.
    if (typeof console === "undefined") {
        console = {};
    }
    if (!console.log) { console.log = function(){};}
    if (!console.info) { console.info = console.log; }
    if (!console.debug) { console.debug = console.log; }
    if (!console.error) { console.error = console.log; }

    var prefixLogger = function(prefix, logFunc, logFuncThis) {
        return function() {
            var args = [].slice.apply(arguments); // Duplicate arguments to an array
            if (args.length > 0 && typeof args[0] === "string") {
                args[0] = prefix + " " + args[0];
            } else {
                args.unshift(prefix);
            }
            if (logFunc.apply && typeof logFunc.apply === "function") {
                logFunc.apply(logFuncThis, args);
            }
        };
    };
    // Default: no-op.
    this.debug = this.log = this.info = this.error = function() {};
    // Assign logging functions based on level.
    if (level == "debug") {
        this.debug = prefixLogger(prefix, console.debug, console);
    }
    if (level == "debug" || level == "log") {
        this.log = prefixLogger(prefix, console.log, console);
    }
    if (level == "debug" || level == "log" || level == "info") {
        this.info = prefixLogger(prefix, console.info, console);
    }
    if (level == "debug" || level == "log" || level == "info" || level == "error") {
        this.error = prefixLogger(prefix, console.error, console);
    }
};

return {Logger: Logger};

});


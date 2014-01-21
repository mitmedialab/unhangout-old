/*
 Simple logger.  Usage:

var logger = new Logger("prefix", "info");

Logging levels (most verbose -> least):
     "debug", "log", "info", "error"
*/
var Logger = function(prefix, level) {
    level = level || "debug";

    // Ensure console exists and has necessary properties.
    if (typeof console === "undefined") {
        console = {}
    }
    if (!console.log) { console.log = function(){};}
    if (!console.info) { console.info = console.log; }
    if (!console.debug) { console.debug = console.log; }
    if (!console.error) { console.error = console.log; }
    
    var prefixLogger = function(prefix, logFunc, logFuncThis) {
        return function() {
            var args;
            if (arguments.length > 0 && typeof arguments[0] === "string") {
                arguments[0] = prefix + " " + arguments[0];
                args = arguments;
            } else {
                args = [prefix].concat(arguments);
            }
            logFunc.apply(logFuncThis, args);
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


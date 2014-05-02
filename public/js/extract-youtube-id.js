if (typeof define !== 'function') { var define = require('amdefine')(module) }

define(function() {

// From http://stackoverflow.com/a/6904504 , covering any of the 15 or so
// different variations on youtube URLs.  Also works permissively on full
// iframe/object embed codes.  Returns empty string if empty string is given;
// returns null if no valid ID is found; otherwise, returns the 11 character
// YouTube ID.
var extractYoutubeId = function(val) {
    if (val === "") {
        return "";
    }
    var ytid;
    if (/^[-A-Za-z0-9_]{11}$/.test(val)) {
        ytid = val;
    } else {
        var re = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/i;
        var match = re.exec(val);
        if (match) {
            ytid = match[1];
        } else {
            ytid = null;
        }
    }
    return ytid;
};

return { extractYoutubeId: extractYoutubeId }

});

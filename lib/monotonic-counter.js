// We need a guaranteed monotonic counter for the oplog, but want to avoid
// persisting a global counter across server restarts.  `process.hrtime` would
// fit the bill, except that it overflows after a few days, breaking
// monotonicity and hence breaking the op log (see
// https://github.com/drewww/unhangout/issues/336).  Instead, we're using a
// tuple of Date.now (milliseconds) and a self-resetting counter that
// increments for subsequent messages sent within the same millisecond.  If
// there's a sufficiently long gap between messages that we can guarantee there
// were no outstanding messages from the current millisecond, we reset the
// counter.
// 
// Assuming there is always at least 1ms between a server restart and the first
// new message, this tuple is guaranteed monotonic, and won't overflow or
// encounter IEEE float issues until `Date.now()` does.

var count = 0;
var resetCount;
function timestamp() {
    count++;
    if (resetCount) {
        clearTimeout(resetCount);
    }
    resetCount = setTimeout(function() {
        count = 0;
    }, 2);
    return [Date.now(), count];
}

// provided to set initial condition of tests.
function _resetCount() {
    count = 0;
}

module.exports = {
    timestamp: timestamp,
    _resetCount: _resetCount
}

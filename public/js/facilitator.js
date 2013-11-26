var event = new models.Event(EVENT_ATTRS);
var session = new models.Session(SESSION_ATTRS);
var sock = new SockJS(document.location.protocol + "//" + document.location.hostname + ":" + document.location.port + "/sock");

// Convenience wrapper for posting messages.
sock.sendJSON = function(type, data) {
    sock.send(JSON.stringify({type: type, args: data}));
}

// Our socket is not just correct, not just articulate... it is *on message*.
sock.onmessage = function(message) {
    var msg = JSON.parse(message.data);
    console.log(msg.type, msg.args);
    switch (msg.type) {
        case "auth-ack":
            // When we're authorized, join the room for this session.
            sock.sendJSON("join", {id: "session/" + session.id});
            break;
        case "session/set-hangout-url-err":
            // We got a different URL when we tried to set the hangout url.
            // TODO: notify the user that this is the wrong URL for this
            // hangout; the right one is in msg.args.url.
            break;
    }
}

// TODO: merge the parts of public/js/event-app.js and this which are the same
// to avoid duplication.
sock.onopen = function() {
    // Authorize ourselves, then join the room.
    console.log("open");
    sock.sendJSON("auth", {key: SOCK_KEY, id: USER_ID});
    // Once we have a socket open, acknowledge the hangout gadget informing us
    // of the hangout URL.
    window.addEventListener("message", function(event) {
        if (HANGOUT_ORIGIN_REGEX.test(event.origin)) {
            if (event.data.type == "data") {
                if (event.data.args.url) {
                    console.log("inner set", event.data.args.url, event.origin);
                    session.set("hangout-url", event.data.args.url);
                    window.parent.postMessage({type: "ack"}, event.origin);
                }
            }
        }
    }, false);
};
// TODO: merge the parts of public/js/event-app.js and this which are the same
// to avoid duplication.
sock.onclose = function() {
    $('#disconnected-modal').modal('show');
    var checkIfServerUp = function() {
        var ping = document.location;
        $.ajax({
            url: ping,
            cache: false,
            async: false,
            success: function(msg) {
                window.location.reload();
            },
            error: function(msg) {
                timeout = setTimeout(checkIfServerUp, 250);
            }
        });
    };
    checkIfServerUp();
};

// Let the server know about changes to the hangout URL.
session.on("change:hangout-url", function() {
    sock.sendJSON("session/set-hangout-url", {
        url: session.get("hangout-url"),
        sessionId: session.id
    });
});

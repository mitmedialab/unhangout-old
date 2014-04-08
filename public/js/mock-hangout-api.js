var FauxCanvas = function() {
    var div = document.createElement('div');
    div.style.position = 'absolute';
    div.style.width = '320px';
    div.style.height = '240px';
    div.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
    div.style.outlineColor = "blue";
    div.style.outlineWidth = "3px";
    div.style.outlineStyle = "ridge";
    div.style.zIndex = '100000';
    div.style.display = 'none';
    var appended = false;
    var aspectRatio = 1.5;

    this.setPosition = function(value, opt_top) {
        var left = typeof opt_top != "undefined" ? value : value.left;
        var top = typeof opt_top != "undefined" ? opt_top : value.top;
        // Leave room for the outline, to aid in debugging scaling.
        div.style.left = parseInt(left + 3) + "px";
        div.style.top = parseInt(top + 3) + "px";
    };
    this.getAspectRatio = function() {
        return aspectRatio;
    };
    this.setVisible = function(visible) {
        div.style.display = visible ? 'block' : 'none';
        if (!appended) {
            document.body.appendChild(div);
            appended = true;
        }
    };
    this.setHeight = function(height) {
        // Sets both height and width based on current aspect ratio.
        // Leave room for the outline, to aid in debugging scaling.
        div.style.height = (height-6) + "px";
        div.style.width = (aspectRatio*height - 6) + "px";
    };
    this.setWidth  = function(width)  {
        // Sets both height and width based on current aspect ratio.
        // Leave room for the outline, to aid in debugging scaling.
        div.style.width  = (width-6)  + "px";
        div.style.height = (width/aspectRatio - 6) + "px";
    };
};
var FauxNotice = function() {
    var div = document.createElement('div');
    div.id = "mock-hangout-notice";
    div.style.position = 'absolute';
    div.style.height = '100px';
    div.style.backgroundColor = 'rgb(0, 120, 255)';
    div.style.boxSizing = div.style.mozBoxSizing = div.style.webkitBoxSizing = 'border-box';
    div.style.padding = '1em';
    div.style.color = "white";
    div.style.zIndex = '200000';
    div.style.display = 'none';
    div.style.top = '10px';
    div.style.right = '10px';

    var messageEl = document.createElement('p');
    div.appendChild(messageEl);

    var show = function() { div.style.display = 'block'; };
    var hide = function() { div.style.display = 'none'; };

    var closeEl = document.createElement('a');
    closeEl.innerHTML = 'X';
    closeEl.style.position = 'absolute';
    closeEl.style.top = 0;
    closeEl.style.right = 0;
    closeEl.style.cursor = 'pointer';
    closeEl.addEventListener('click', hide);
    closeEl.className = 'dismiss-notice';
    div.appendChild(closeEl);

    var appended = false;

    this.hasNotice = function() {
        return div.style.display == 'block';
    };
    var timeout;
    this.displayNotice = function(message, opt_permanent) {
        if (!appended) {
            document.body.appendChild(div);
            appended = true;
        }
        messageEl.innerHTML = message;
        show();
        if (timeout) {
            clearTimeout(timeout);
        }
        if (!opt_permanent) {
            timeout = setTimeout(hide, 5000);
        }
    };
    this.dismissNotice = hide;
};
var fauxCanvas = new FauxCanvas();
var fauxNotice = new FauxNotice();

// Make global -- no 'var'.
gadgets = {
    util: {
        registerOnLoadHandler: function(cb) {
            cb();
        }
    },
    views: {
        getParams: function() {
            return {"appData": MOCK_DATA.appData};
        }
    }
};
// Make global -- no 'var'.
var _APP_IS_VISIBLE = true;
gapi = {
    hangout: {
        isAppVisible: function() {
            return _APP_IS_VISIBLE;
        },
        onApiReady: {
            add: function(cb) {
                cb({isApiReady: true});
            }
        },
        getLocalParticipantId: function() {
            return "mock-user-id"
        },
        getHangoutUrl: function() {
            return MOCK_DATA.hangoutUrl;
        },
        getHangoutId: function() {
            return MOCK_DATA.hangoutUrl + "-id";
        },
        getParticipants: function() {
            return MOCK_DATA.users;
        },
        hideApp: function() {
            if (_APP_IS_VISIBLE) {
                alert("Hangout got 'hideApp' call; app is now 'invisible'.");
                _APP_IS_VISIBLE = false;
            }
        },
        av: {
            muteParticipantMicrophone: function(participantId) {
                console.log("Microphone muted");
            }
        },
        data: {
            setValue: function(){},
            getValue: function(key) {
                if (key == "sessionId") {
                    return MOCK_DATA.appData.split(":")[1];
                }
            }
        },
        layout: {
            getVideoCanvas: function() {
                return fauxCanvas;
            },
            displayNotice: fauxNotice.displayNotice,
            dismissNotice: fauxNotice.dismissNotice,
            hasNotice:     fauxNotice.hasNotice
        },
        onair: {
            getYouTubeLiveId: function() {
                return MOCK_DATA.isHoA ? "sXzK0AFpmcI" : null;
            },
            isOnAirHangout: function() {
                return MOCK_DATA.isHoA;
            }
        }
    }
};

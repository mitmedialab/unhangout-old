define([
   "underscore", "jquery", "backbone", "sockjs", "auth", "logger", "models"
], function(_, $, Backbone, SockJS, auth, logging, models) {


var logger = new logging.Logger("transport");

var Transport = function(roomId) {
    this._setState("CONNECTING");
    this.stateModels = {};

    this.sock = new SockJS(
        document.location.protocol + "//" +
        document.location.hostname +
        (document.location.port ? ":" + document.location.port : "") +
        "/sock");

    this.sock.onopen = _.bind(function() {
        this._setState("AUTHENTICATING");
        this.sock.send(JSON.stringify({
            type: "auth",
            args: {key: auth.SOCK_KEY, id: auth.USER_ID}
        }));
    }, this);

    this.sock.onmessage = _.bind(function(message) {
        var msg = JSON.parse(message.data);
        logger.debug(msg.timestamp, msg.type, msg.args);
        if (msg.timestamp) {
            this.latest = msg.timestamp;
        }
        // Handle connection negotiation, and delegate state change messages.
        switch (msg.type) {
            case "auth-ack":
                this._setState("JOINING");
                this.send("join", {id: roomId, timestamp: window.INITIAL_DATA_TIMESTAMP});
                break;
            case "auth-err":
                this._setState("AUTH-ERROR");
                break;
            case "join-ack":
                this._setState("JOINED");
                break;
            case "join-err":
                this._setState("JOIN-ERROR");
                break;
            case "state":
                this.handleStateChange(msg.args);
                break;
            case "stale-state-err":
                this._setState("STALE-STATE-ERROR");
                // Instruct clients to refresh their state (typically reloading
                // the page).
                this.trigger("close");
                this.trigger("back-up");
                break;
        }
        // Log all errors.
        if (msg.type.indexOf("-err") != -1) {
            logger.error(message);
        }
        // Trigger all messages, even if we've handled them above.
        this.trigger(msg.type, msg.args);
    }, this);

    // handle losing the connection to the server.
    //
    // Listen for `transport.on('close')` to display a notice to the user when
    // the socket connection has closed for any reason.
    //
    // Listen for `transport.on('back-up')` to take action when the server has
    // come back on line.
    this.sock.onclose = _.bind(function() {
        this._setState("CLOSED");
        this.trigger('close');
        var checkIfServerUp = _.bind(function() {
            $.ajax({
                url: document.location,
                type: "HEAD",
                cache: false,
                success: _.bind(function(msg) { this.trigger("back-up"); }, this),
                error: function(msg) { setTimeout(checkIfServerUp, 1000); }
            });
        }, this);
        // Run the first check at a random interval to hopefully spread out
        // requests to a seiged server trying to restart.
        setTimeout(checkIfServerUp, 1000 * Math.random());

    }, this);
};
_.extend(Transport.prototype, Backbone.Events, {
    _setState: function(state) {
        this.state = state;
        this.trigger("status", this.state);
    },
    registerModel: function(name, model) {
        this.stateModels[name] = model;
    },
    unregisterModel: function(name, moel) {
        delete this.stateModels[name];
    },

    // `handleStateChange' takes a set of basic operations (modeled after
    // sharejs's operations, as we might move to that eventually) to mutate the
    // state of backbone models.
    handleStateChange: function(args) {
        // 'args' should look like:
        //
        //  SET a value of a property
        //
        //  {
        //      path: ["event/1", "sessions", 3, "title"],
        //      op: "set",
        //      value: "New title"
        //  }
        //
        //  SET a value of a property with type cast:
        //  {
        //      path: ["event/1", "hoa"],
        //      op: "set",
        //      type: "Session"
        //      value: {id: 4, title: ...}
        //  }
        //
        //  SET multiple properties of a submodel:
        //  {
        //      path: ["event/1", "hoa", null],
        //      op: "set",
        //      value: {id:4, title: ...}
        //  }
        //
        //  INSERT a list member
        //  {
        //      path: ["event/1", "connectedUsers"],
        //      op: "insert",
        //      pos: 4,
        //      value: {userId: 4, displayName: ...}
        //  }
        //
        //  INSERT a model into a sub collection
        //  { 
        //      path: ["event/1", "sessions"],
        //      op: "insert",
        //      pos: 4,
        //      type: "Session",
        //      value: {id: blah, etc.}
        //  }
        //  
        //  REMOVE a list member
        //  {
        //      path: ["event/1", "connectedUsers"],
        //      op: "delete",
        //      pos: 4 -OR- findWhere: {..details..}
        //  }
        //
        //  REMOVE a member of a collection
        //  {
        //      path: ["event/1", "sessions"],
        //      op: "delete",
        //      pos: 4 -OR- findWhere: {..details..}
        //  }
        //

        var path = _.clone(args.path);
        var model = this.stateModels[path.shift()];
        if (!model) {
            return logger.info("Update for unknown model", msg);
        }
        while (path.length > 1) {
            model = model.get(path.shift());
            if (!model) {
                return logger.info("Update for unknown model", msg);
            }
        }

        var name = path.pop(); // path should now be empty.
        // The "subject" is the thing that is being mutated.
        var subject = name ? model.get(name) : model;
        
        // Cast the value into the appropriate type, if any.
        var value;
        if (args.type && args.value != null) {
            switch (args.type) {
                case "User":
                    value = new models.User(args.value);
                    break;
                case "Session":
                    value = new models.Session(args.value);
                    break;
                case "ChatMessage":
                    value = new models.ChatMessage(args.value);
                    break
                default:
                    logger.error("Unknown transport casting type", args.type);
                    return;
            }
        } else {
            value = args.value;
        }

        // Execute operations on the model.
        switch (args.op) {
            case "set":
                if (name === null) {
                    model.set(value);
                } else {
                    model.set(name, value);
                }
                break;

            case "unset":
                if (name !== null) {
                    model.unset(name);
                } else {
                    return logger.error("Cannot unset a null name");
                }
                break;

            case "insert":
                // check if this is a collection by looking for an 'add' method.
                if (subject.add) {
                    var options;
                    if (args.pos !== undefined) {
                        options = {at: args.pos}
                    }
                    subject.add(value, options);
                } else {
                    if (args.pos !== undefined) {
                        subject.splice(args.pos, 0, value);
                    } else {
                        subject.push(value);
                    }
                    model.trigger("change:" + name, model, value, {});
                    model.trigger("change", model);
                }
                break;

            case "delete":
                if (args.pos === undefined && args.findWhere === undefined && value === undefined) {
                    return logger.error("`delete` needs either 'pos', 'findWhere', or 'value'");
                }
                // check if this is a collection.
                if (subject.remove && subject.at && subject.findWhere) {
                    if (args.pos !== undefined) {
                        subject.remove(subject.at(args.pos));
                    } else if (args.findWhere !== undefined) {
                        subject.remove(subject.findWhere(args.findWhere));
                    } else if (value !== undefined) {
                        subject.remove(value);
                    }
                } else {
                    if (args.pos !== undefined) {
                        subject.splice(args.pos, 1);
                    } else if (args.findWhere !== undefined) {
                        var val = _.findWhere(subject, args.findWhere);
                        model.set(name, _.without(subject, val));
                    } else if (value !== undefined) {
                        model.set(name, _.without(subject, value));
                    }
                }
                break;
        }

    },
    send: function(type, args) {
        this.sock.send(JSON.stringify({type: type, args: args}));
    }
});

return {Transport: Transport};

});

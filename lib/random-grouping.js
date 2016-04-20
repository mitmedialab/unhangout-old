var _ = require("underscore"),
    logger = require("./logging").getLogger(),
    Promise = require("bluebird"),
    models = require("./server-models");

module.exports = function(db, options) {
    var group = {};

    /**
     * Create a new randomized session
     * @param {ServerEvent} event - the ServerEvent instance on which to create a session
     * @return {Promise} A promise which resolves with the ID of the new session.
     */
    group._createRandomizedSession = function(event) {
        return new Promise(function(resolve, reject) {
            var roomNum = event.getRandomizedSessions().length + 1;
            var title = "Breakout Room " + roomNum;
            // Force sessions type to be "simple"
            var activities = [{type: "about", autoHide: true}];
            /* Keep the sessions' joining cap as 6 for now, we'll change this 
            later and make it as an input available for admins */
            var joinCap = 6; 

            var newSession = new models.ServerSession({
                title: title,
                proposedBy: null,
                activities: activities,
                joinCap: joinCap,
                description: "",
                approved: true,
                randomized: true,
                assignedParticipants: []
            }, {
                collection: event.get("sessions")
            });
            newSession.save({}, {
                success: function() {
                    event.get("sessions").add(newSession);            
                    return resolve(newSession);
                },
                error: function(err) {
                    return reject(err, "Error creating session");
                }
            });
        });
    };

    /**
     * Assign the given user to any available randomized session within the
     * given event, creating a new session if necessary.  Clears previous 
     * user assignments if any.
     * @param {String} eventId - The ID of the event to assign a session on
     * @param {String} userId - the ID of the user to assign to a session
     * @return {Promise} A promise which resolves with the assigned session ID.
     */
    group.assignRandomizedSession = function(eventId, userId) {
        var user = db.users.get(userId);
        var event = db.events.get(eventId);
        return Promise.resolve().then(function() {
            if (!user) { throw new Error("User is missing."); }
            if (!event) { throw new Error("Event is missing."); }
            var randomizedSessionsList = event.getRandomizedSessions();

            // If the user has an existing assignment for a session, clear it.
            var assign = user.get("sessionAssignments");
            if (assign && assign[eventId]) {
                // remove user as assigned participant from each session.
                var session = db.events.getSessionById(assign[eventId]);
                if (session) {
                    session.removeAssignedParticipant(user);
                }
                // remove previously assigned sessions as choices for the next assignment.
                randomizedSessionsList = _.filter(randomizedSessionsList, function(sess) {
                    return assign[eventId] !== sess.id;
                });
                user.setSessionAssignment(eventId, null);
            }

            // Look for an available session
            for (var c = 0; c < randomizedSessionsList.length; c++) {
                var session = randomizedSessionsList[c];
                var assigned = session.addAssignedParticipant(userId);
                if (assigned) {
                    return session;
                }
            }
            // No available session found -- create a new one.
            return group._createRandomizedSession(event).then(function(session) {
                event.logAnalytics({
                    action: "create-session",
                    user: user,
                    session: session,
                    title: session.get("title"),
                    activities: session.get("activities"),
                    description: ""
                });
                var assigned = session.addAssignedParticipant(userId);
                if (!assigned) {
                  throw new Error("Failed to assign user to new session");
                }
                return session;
            });
        }).then(function(session) {
            user.setSessionAssignment(eventId, session.id);
            return session.id;
        });
    };

    return group;
};

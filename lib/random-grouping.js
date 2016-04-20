var _ = require("underscore"),
    logger = require("./logging").getLogger(),
    Promise = require("bluebird"),
    models = require("./server-models");

module.exports = function(db, options) {
    var group = {};

    /**
     * Create a new randomized session, and assign the given user to it.
     * @param {String} eventId - the ID of the event to create the session in
     * @param {String} userId - the ID of the user to assign to the session.
     * @return {Promise} A promise which resolves with the ID of the new session.
     */
    group.createSessionWithUser = function(eventId, userId) {
        return new Promise(function(resolve, reject) {
            var user = db.users.get(userId);
            var event = db.events.get(eventId);
            var randomizedSessionsList = group.getRandomizedSessionsList(eventId);
            var roomNum = randomizedSessionsList.length + 1; 
            var title = "Breakout Room " + roomNum;
            //Force sessions type to be "simple"
            var activities = [];
            activities.push({type: "about", autoHide: true});
            /* Keep the sessions' joining cap as 6 for now, we'll change this 
            later and make it as an input available for admins */
            var joinCap = 6; 
            var newSession;

            newSession = new models.ServerSession({
                title: title,
                proposedBy: null,
                activities: activities,
                joinCap: joinCap,
                description: "",
                approved: true,
                randomized: true,
                assignedParticipants: [userId]
            }, {
                collection: event.get("sessions")
            });
            newSession.save({}, {
                success: function() {
                    event.get("sessions").add(newSession);            
                    event.logAnalytics({
                        action: "create-session",
                        user: user,
                        session: newSession,
                        title: title,
                        activities: activities,
                        description: ""
                    });
                    return resolve(newSession.id);
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
     * user assignments and preferences if any.
     * @param {String} eventId - The ID of the event to assign a session on
     * @param {String} userId - the ID of the user to assign to a session
     * @return {Promise} A promise which resolves with the assigned session ID.
     */
    group.assignRandomizedSession = function(eventId, userId) {
        var user = db.users.get(userId);
        return Promise.resolve().then(function() {
            if (!user) {
                throw new Error("Error! User is missing.");
            }
            var randomizedSessionsList = group.getRandomizedSessionsList(eventId);

            // If the user has an existing preference for a session, clear it.
            var pref = user.get("sessionPreference");
            if (pref && pref[eventId]) {
                // remove user as assigned participant from each session.
                var session = db.events.getSessionById(pref[eventId]);
                if (session) {
                    session.removeAssignedParticipant(user);
                }
                // remove previously assigned sessions as choices for the next assignment.
                randomizedSessionsList = _.filter(randomizedSessionsList, function(sess) {
                    return pref[eventId] !== sess.id;
                });
                user.setSessionPreference(eventId, null);
            }

            // Look for an available session
            for (var c = 0; c < randomizedSessionsList.length; c++) {
                var session = randomizedSessionsList[c];
                var assigned = session.addAssignedParticipant(userId);
                if (assigned) {
                    return session.get("id");
                }
            }

            // No available session found -- create a new one.
            return group.createSessionWithUser(event, userId)
        }).then(function(sessionId) {
            user.setSessionPreference(eventId, sessionId);
            return sessionId;
        });
    };

    /**
     * Return a new list of all sessions within the event which are
     * "randomized".
     * @param {String} eventId - The ID of the event
     * @return {Array<Session>} An array of session model instances.
     */
    group.getRandomizedSessionsList = function(eventId) {
        var event = db.events.get(eventId);
        if (!event) {
            return reject("Error! Event is missing.");
        }
        var randomizedSessionsList = [];
        event.get("sessions").each(function(session) {
            if(session.get("randomized")) {
                randomizedSessionsList.push(session);
            }
        });
        return randomizedSessionsList;
    };

    return group;
};

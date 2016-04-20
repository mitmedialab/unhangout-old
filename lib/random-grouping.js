var _ = require("underscore"),
    logger = require("./logging").getLogger(),
    Promise = require("bluebird"),
    deepCopy = require("deep-copy"),
    models = require("./server-models");

module.exports = function(db, options) {
    var group = {};

    group.assignGroupToUser = function(userId, eventId) { 
        return new Promise(function(resolve, reject) {
            var user = db.users.get(userId);
            var pref = deepCopy(user.get("sessionPreference") || {});
            if(!pref || pref[eventId] == '' || pref[eventId] == undefined) {
                pref[eventId] = [];  
                return resolve(group.addUserToSessionAssignedParticipantsList(eventId, userId));
            } else {
                return reject("User already has a session preference!");
            }
        });
    };

    group.createSession = function(eventId, userId) {
        return new Promise(function(resolve, reject) {
            var user = db.users.get(userId);
            var event = db.events.get(eventId);
            var randomizedSessionsList = [];
            event.get("sessions").each(function(session) {
                if(session.get("randomized")) {
                    randomizedSessionsList.push(session.get("id"));
                }
            });
            var roomNum = randomizedSessionsList.length + 1; 
            var title = "Breakout Room " + roomNum;
            //Force sessions type to be "simple"
            var activities = [];
            activities.push({type: "about", autoHide: true});
            /* Keep the sessions' joining cap as 2 for now, we'll change this 
            later and make it as an input available for admins */
            var joinCap = 2; 
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
                    return resolve({newSessionId: newSession.id});
                },
                error: function(err) {
                    return reject(err, "Error creating session");
                }
            });
        });
    };

    group.addUserToSessionAssignedParticipantsList = function(eventId, userId) {
        return new Promise(function(resolve, reject) {
            var user = db.users.get(userId);
            var event = db.events.get(eventId);
            if (!user || !event) {
                return reject("Error! User or event is missing.");
            } 
            var randomizedSessionsList = [];
            event.get("sessions").each(function(session) {
                if(session.get("randomized")) {
                    randomizedSessionsList.push(session.get("id"));
                }
            });
            if(randomizedSessionsList.length == 0) {
                group.createSession(eventId, userId).then(function(data) {
                    user.setSessionPreference(eventId, data.newSessionId);
                    return resolve();
                });  
            } else {
                var vacantSlotFound = false;
                for(var c=0; c< randomizedSessionsList.length; c++) {
                    var session = db.events.getSessionById(randomizedSessionsList[c]);
                    if(session.get("randomized")) { 
                        var assignees = session.get("assignedParticipants");
                        if(!assignees) {
                            assignees = [];
                        } 
                        if(assignees.indexOf(user.get("id")) >= 0) {
                            return reject("Error! User is already in the session assigned participant list");;
                        } 
                        if(assignees.length >= session.get("joinCap")) { 
                            continue; 
                        } else {
                            vacantSlotFound = true; 
                            assignees.push(userId);
                            session.setAssignedParticipants(assignees);
                            user.setSessionPreference(eventId, session.get("id"));
                            return resolve();
                        } 
                    }                      
                }

                if(!vacantSlotFound) {
                    group.createSession(eventId, userId).then(function(data) {
                        user.setSessionPreference(eventId, data.newSessionId);
                        return resolve();
                    }); 
                }
            }
        });
    };
    return group;
};
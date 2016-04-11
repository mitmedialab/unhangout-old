var _ = require("underscore"),
    logger = require("./logging").getLogger(),
    Promise = require("bluebird"),
    deepCopy = require("deep-copy"),
    models = require("./server-models");

module.exports = function(db, options) {
  var group = {};

  group.assignGroupToUser = function(userId, eventId) {
    var user = db.users.get(userId);
    var event = db.events.get(eventId);
    if (!user || !event) {
      return null;
    }
    var pref = deepCopy(user.get("sessionPreference") || {});
    /* for testing purpose uncomment the following
    set preference as null and return */
    //user.set("sessionPreference", {});
    //user.save();
    //return;
    /* 
      if a users' session preference for an event is null 
      then only execute the grouping algorithm
    */
    if(!pref || pref[eventId] == '' ||
      pref[eventId] == undefined) {
      pref[eventId] = []; 
      /* 
        if there aren't any sessions in an event
        then create a session and assign it to 
        a users' preference
      */
      if(event.get("sessions").length == 0) {
        group.callCreateSession(eventId, userId); 
      } else {
        /*
          if there are sessions then iterate
          over the list and check for the ones
          which were created in the randomized
          event mode 
        */
        var randomizedSessionsList = [];
        event.get("sessions").each(function(session) {
          if(session.get("randomized")) {
            randomizedSessionsList.push(session);
          }
        });
        
        if(randomizedSessionsList.length == 0) {
          group.callCreateSession(eventId, userId); 
        } else {
          randomizedSessionsList.each(function(session) {
            if(session.get("randomized")) { 
              var assignees = session.get("assignedParticipants");
              if(!assignees) {
                assignees = [];
              } 
              /* 
                if the user is already in the list of a 
                session's assigned participants list
                then do not execute further
              */
              if(assignees.indexOf(user.get("id")) >= 0) {
                return;
              } 
              /* 
                if a session's assigned participant list
                is less than it's maximum joining capacity
                then only assign it as a user's session
                preference
              */

              if(assignees.length < session.get("joinCap")) {  
                assignees.push(userId);
                session.set("assignedParticipants", assignees);
                session.save();
                var pref = deepCopy(user.get("sessionPreference") || {});
                if(!pref[eventId]) {
                  pref[eventId] = [];
                }
                pref[eventId].push(session.get("id"));
                user.set("sessionPreference", pref);
                user.save();
              } else {
                /* 
                if a session's assigned participant list
                  is more than or equal to it's maximum 
                  joining capacity then create a new 
                  session
                */
                group.callCreateSession(eventId, userId); 
              } 
            }                      
          }); //each loop ends here
        }
      }
    } else {
      logger.info("User already has a session preference!");
    }
  };

  group.callCreateSession = function(eventId, userId) {
    var user = db.users.get(userId);
    group.createSession(eventId, userId).then(function(data) {
        if(data.newSessionId == null) {
          return;
        } 
        var pref = deepCopy(user.get("sessionPreference") || {});
        if(!pref[eventId]) {
          pref[eventId] = [];
        }
        pref[eventId].push(data.newSessionId);
        user.set("sessionPreference", pref); 
        user.save(); 
      });
  };

  group.createSession = function(eventId, userId) {
    var user = db.users.get(userId);
    var event = db.events.get(eventId);
    var roomNum = event.get("sessions").length + 1; 
    var title = "Breakout Room " + roomNum;
    //Force sessions type to be "simple"
    var activities = [];
    activities.push({type: "about", autoHide: true});
    /* Keep the sessions' joining cap as 2 for now, 
      we'll change this later and make it as an input
      available for admins
    */
    var joinCap = 2; 
    var newSession;
    return new Promise(function(resolve, reject) {
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
  return group;
};
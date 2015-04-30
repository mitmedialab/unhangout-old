var _ = require("underscore");
var Promise = require("bluebird");

module.exports = function(db, options) {
  var followup = {};

  followup.context = function(eventId, participantIndex) {
    var event = db.events.get(eventId);
    if (!event) {
      return null;
    }
    var eventUserIds = _.keys(event.get("history").event);
    eventUserIds.sort();
    var userId = eventUserIds[participantIndex];

    if (!userId) {
      return null;
    }

    var user = db.users.get(userId);
    var networkUserIds = {};
    var networkUsers = []; 

    if(user.get("networkList")) {
      networkUserIds = user.get("networkList")[event.id];
      networkUsers = _.map(networkUserIds, function(id) {
        return db.users.get(id);
      });
    }

    var cohortIds = event.getUserIdsSharingSessionsWith(userId);
    var recipient = {
      user: db.users.get(userId),
      users: _.map(cohortIds, function(id) { return db.users.get(id) })
    };

    return {
      event: event,
      participantIndex: participantIndex,
      recipient: recipient,
      totalUsers: eventUserIds.length,
      fromEmail: options.UNHANGOUT_SERVER_EMAIL_ADDRESS,
      networkUsers: networkUsers, 
    }
  };

  followup.renderEmail = function(res, event, participantIndex) {
    return new Promise(function(resolve, reject) {
      var context = followup.context(event.id, participantIndex);
      if (!context) {
        return resolve();
      }

      var user = context.recipient.user;
      res.render("post_event_followup_email.ejs", context, function(err, html) {
        if (err) {
          return reject(err, "Error rendering email body");
        }
        return resolve({html: html, user: user});
      });
    });
  };

  followup.renderAllEmails = function(res, event) {
    var userIndices = _.range(_.size(event.get("history").event));
    return Promise.map(userIndices, function(userIndex) {
      return followup.renderEmail(res, event, userIndex);
    });
  };

  followup.sendEmails = function(htmlAndUsers) {
    var mandrill_client = new mandrill.Mandrill(options.MANDRILL_API_KEY);
    var emailsSent = 0;
    return Promise.map(htmlAndUsers, function(htmlAndUser) {
      var html = htmlAndUser.html;
      var user = htmlAndUser.user;

      var message = {
        "html": html,
        "subject": "Following up from the Unhangout",
        "from_email": options.UNHANGOUT_SERVER_EMAIL_ADDRESS,
        "from_name": "Unhangout Team",
        "to": [{
          "email": user.get("emails")[0].value,
          "name": user.getShortDisplayName()
        }],
        "headers": {"Reply-To": options.UNHANGOUT_SERVER_EMAIL_ADDRESS},
        "important": false,
        "track_opens": true,
        "track_clicks": true,
        "auto_text": true
      };
      return new Promise(function(resolve, reject) {
        mandrill_client.messages.send({"message": message}, function(result) {
          if (result[0].status == 'sent') {
            emailsSent += 1;
          }
          resolve();
        }, function(err) {
          reject(err);
        })
      });
    }).then(function() {
      return {
        sent: emailsSent,
        total: htmlAndUsers.length
      };
    });
  };

  return followup;
};


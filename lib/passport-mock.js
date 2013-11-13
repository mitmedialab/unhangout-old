var models      = require('./server-models.js'),
    _           = require("underscore");

// drawn from http://hackerpreneurialism.com/post/48344246498/node-js-testing-mocking-authenticated-passport-js#sthash.qJ6lzTnq.dpuf
var mockUsers = {
    'regular1': {
        id: "0",
        name: {givenName: "Regular1", familyName: "Mock"},
        displayName: "Regular1 Mock",
        email: [{value: "regular1@example.com"}],
        "sock-key": "regular1",
        admin: false
    },
    'regular2': {
        id: "1",
        name: {givenName: "Regular2", familyName: "Mock"},
        displayName: "Regular2 Mock",
        email: [{value: "regular2@example.com"}],
        "sock-key": "regular2",
        admin: false
    },
    'admin1': {
        id: "2",
        name: {givenName: "Admin1", familyName: "Mock"},
        displayName: "Admin1 Mock",
        email: [{value: "admin1@example.com"}],
        "sock-key": "admin1",
        admin: true
    },
    'admin2': {
        id: "3",
        name: {givenName: "Admin2", familyName: "Mock"},
        displayName: "Admin2 Mock",
        emails: [{value: "admin2@example.com"}],
        "sock-key": "admin2",
        admin: true
    }
};

exports.mockAuthMiddleware = function(server) {
    _.each(mockUsers, function(user) {
        server.db.users.add(new models.ServerUser(user));
    });

    function mockAuth(req, res, next) {
        var mock_user;
        if (req.header("x-mock-user")) {
            mock_user = req.header("x-mock-user");
        } else if (req.cookies.mock_user) {
            mock_user = req.cookies.mock_user;
        } else {
            // unauthenticated.
            return next();
        }
        req.user = server.db.users.findWhere({"sock-key": mock_user});
        next();
    };
    return mockAuth;
};

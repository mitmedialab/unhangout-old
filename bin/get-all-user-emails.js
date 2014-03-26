var _ = require('underscore')._,
    async = require('async'),
    redis = require('redis');

if(require.main === module)
{
    var r = redis.createClient();
    r.on("connect", function() {

        console.log("connected to redis");

        r.keys("user*", function(err, res) {
            async.series(_.map(res, function(key) {
                return function(cb) {
                    console.log("running get on key: " + key);
                    r.get(key, function(err, res) {
                        var user = JSON.parse(res);
                        cb(null, user.emails);
                    });
                };
            }), function(err, results) {

                var emails = [];

                _.each(results, function(list) {
                    _.each(list, function(item) {
                        emails.push(item["value"]);
                        console.log(item["value"]);
                    });
                });

                process.exit();
            });
        });
    });
}

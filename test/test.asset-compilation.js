describe("ASSET COMPILATION", function() {
    this.timeout(120000); // Extra-long timeout for compilation. :(
    if (process.env.SKIP_SELENIUM_TESTS || process.env.SKIP_ASSET_COMPILATION) {
        // Even though we don't use selenium here, act as though we do because
        // we're so slow.
        return;
    }
    it("Compiles assets", function(done) {
        var compiler = require("../bin/compile-assets.js");
        var conf = require("../public/js/requirejs-config.json");
        var count = Object.keys(conf.modules).length - 1;
        var errors = [];
        compiler.compile().then(function() {
            done()
        }).catch(function(err) {
            done(err);
        });
    });
});


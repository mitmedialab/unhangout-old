var expect = require("expect.js"),
    sanitize = require("../lib/utils").sanitize;

/*
 *  Rather than doing a full test of caja-sanitizer, just make sure that the
 *  basics are wired up right and that our custom policy functions work.
 */
describe("SANITIZE HTML", function() {
    it("Removes sketchy stuff", function() {
        expect(sanitize("<a href='javascript:alert(\'foo\');'>hey</a>"
              )).to.eql("<a>hey</a>");
        expect(sanitize("<iframe src='http://example.com'></iframe>"
              )).to.eql("<iframe></iframe>");
        expect(sanitize("<script src='http://example.com'></script>"
              )).to.eql("");
    });
    it("Custom policy: prefixes id's and class names", function() {
        expect(sanitize("<span id='bork' class='one two three'>ok</span>"
              )).to.eql('<span id="userhtml-bork" class="userhtml-one userhtml-two userhtml-three">ok</span>')
    });
    it("Custom policy: refuses non-https embeds", function() {
        var options = require("../lib/options");
        expect(sanitize("<img src='http:/thisimage.com/stuff.gif'>"
              )).to.eql("<img>");
        expect(sanitize('<img src="https://thisimage.com/stuff.gif">'
              )).to.eql('<img src="https://thisimage.com/stuff.gif">');
        // but non-embedded links are fine
        expect(sanitize('<a href="http://example.com">ok</a>'
              )).to.eql('<a href="http://example.com">ok</a>');

    });
});



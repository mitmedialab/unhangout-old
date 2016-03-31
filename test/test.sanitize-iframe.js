var expect = require("chai").expect;
var sanitizeIframe = require("../lib/utils").sanitizeIframe;

/*
 *  Rather than doing a full test of caja-sanitizer, just make sure that the
 *  basics are wired up right and that our custom policy functions work.
 */
describe("SANITIZE IFRAME", function() {
  it("Passes through clean iframe code", function() {
    var code = '<iframe width="560" height="315" src="https://www.youtube.com/embed/zol2MJf6XNE" frameborder="0" allowfullscreen></iframe>';
    expect(sanitizeIframe(code)).to.equal(code);
  });
    
  it("Removes trailing tags", function() {
    var code = "<iframe src='https://asdf.com'></iframe><script src='bad.js'></script><iframe src='https://asdf.com'></iframe>";
    expect(sanitizeIframe(code)).to.equal('<iframe src="https://asdf.com"></iframe>');
  });
  it("Removes leading tags", function() {
    var code = "<p>This is nonsense</p><iframe src='https://asdf.com'></iframe>";
    expect(sanitizeIframe(code)).to.equal('<iframe src="https://asdf.com"></iframe>');
  });
  it("Removes inner html", function() {
    var code = "<iframe src='https://asdf.com'><p>WAT?</p></iframe>";
    expect(sanitizeIframe(code)).to.equal('<iframe src="https://asdf.com"></iframe>');
  });
  it("Returns null for no iframes", function() {
    var code = "<p>wat</p>";
    expect(sanitizeIframe(code)).to.be.null;
  });
  it("Returns null for seriously busted markup", function() {
    var code = "<iframe src='yeah'";
    expect(sanitizeIframe(code)).to.be.null;
  });
});

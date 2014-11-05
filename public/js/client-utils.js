/*
 * Client side javascript utilities
 */

define(function(){

	var utils = {};

	utils.test = function(){
		console.log('testing utils');
	};

  // Finds and replaces valid urls with links to that url. Client-side only
  // of course; all messages are sanitized on the server for malicious content.
  utils.linkify = function(msg) {
      var replacedText, replacePattern1, replacePattern2, replacePattern3, replacePattern4;

      //URLs starting with http://, https://, or ftp://
       replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
       replacedText = msg.replace(replacePattern1, "<a href='$1' target='_blank'>$1</a>");

       //URLs starting with "www." (without // before it, or it'd re-link the ones done above).
       replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
       replacedText = replacedText.replace(replacePattern2, "$1<a href='http://$2' target='_blank'>$2</a>");

       //Change email addresses to mailto:: links.
       replacePattern3 = /(([a-zA-Z0-9\-?\.?]+)@(([a-zA-Z0-9\-_]+\.)+)([a-z]{2,3}))+$/;
      replacedText = replacedText.replace(replacePattern3, "<a href='mailto:$1'>$1</a>");

      return replacedText;
  }



	return utils
}); // End of define
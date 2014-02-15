define(["vendor/underscore"], function(_) {
    // switch underscore templating to {{ }} so it doesn't conflict with ejs.
    _.templateSettings = {
        interpolate : /\{\{=(.+?)\}\}/g,
        escape: /\{\{-(.+?)\}\}/g,
        evaluate: /\{\{(.+?)\}\}/g
    };
    return _;
});

require(["jquery", "bootstrap", "auth", "update-navbars"], function($) {
  $("a[href='/auth/google']").attr("href", "/browsertest/login/");
});

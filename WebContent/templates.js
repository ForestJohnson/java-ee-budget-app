
console.log('1');
angular.module("templates").run(["$templateCache", function($templateCache) {$templateCache.put("routes/home.tmpl.html","\r\n<div>\r\n  Hello World\r\n</div>\r\n");}]);

console.log('2');
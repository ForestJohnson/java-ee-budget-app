
var gulp = require('gulp');
var Builder = require('systemjs-builder');
var ngAnnotate = require('gulp-ng-annotate');
var templateCache = require('gulp-angular-templatecache');

var pathToDist = '../WebContent/';
var pathToSrc = 'app/';

var html = 'index.html';
var bootstrap = 'jspm_packages/github/twbs/bootstrap@3.3.5/css/bootstrap.css'
var watchJs = '**/*.js';
var watchLess = '**/*.less';
var watchTemplates = '**/*.tmpl.html';

// gulp.task('ng-annotate', [], function() {
//   return gulp.src(pathToSrc+watchJs)
//       .pipe(ngAnnotate({
//         sourceType: 'module'
//       }))
//       .pipe(gulp.dest(pathToSrc));
// });

gulp.task('bundle-js', [], function () {
  var builder = new Builder('./', 'config.js')

  return builder.buildStatic(pathToSrc+'index.js', pathToDist+'index.js', {
	  runtime: false,
	  sourceMaps: true
  })
  .catch(function(err) {
    console.log('Build error');
    console.log(err);
  });
});

gulp.task('copy-html', [], function() {
  return gulp.src(pathToSrc+html)
        .pipe(gulp.dest(pathToDist));
});

gulp.task('bundle-templates', [], function() {
  return gulp.src(pathToSrc+watchTemplates)
        .pipe(templateCache())
        .pipe(gulp.dest(pathToDist));
});

gulp.task('copy-css', [], function() {
  return gulp.src(bootstrap)
        .pipe(gulp.dest(pathToDist));
});

gulp.task('build', ['copy-html', 'bundle-templates', 'copy-css', 'bundle-js'], function(){});

gulp.task('watch', [], function() {
  gulp.watch(pathToSrc+html, ['copy-html']);
  gulp.watch(pathToSrc+watchTemplates, ['bundle-templates']);
  gulp.watch(pathToSrc+watchJs, ['bundle-js']);
  //gulp.watch(pathToSrc+watchLess, ['copy-css']);
});

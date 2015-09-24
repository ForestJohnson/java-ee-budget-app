
var gulp = require('gulp');
var browserSync = require('browser-sync').create();
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


gulp.task('bundle-templates', [], function() {
  return gulp.src(pathToSrc+watchTemplates)
        .pipe(templateCache({
                module: 'template-cache',
                standalone: true,
                root: 'app/',
                moduleSystem: 'IIFE'
            }))
        .pipe(gulp.dest(pathToDist));
});

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


gulp.task('copy-css', [], function() {
  return gulp.src(bootstrap)
        .pipe(gulp.dest(pathToDist));
});

gulp.task('build', ['copy-html', 'copy-css', 'bundle-templates', 'bundle-js'], function(){});

gulp.task('bundle-templates-watch', ['bundle-templates'], browserSync.reload);
gulp.task('copy-html-watch', ['copy-html'], browserSync.reload);
gulp.task('bundle-js-watch', ['bundle-js'], browserSync.reload);

gulp.task('watch', ['build'], function() {
  gulp.watch(pathToSrc+html, ['copy-html-watch']);
  gulp.watch(pathToSrc+watchJs, ['bundle-js-watch']);
  gulp.watch(pathToSrc+watchTemplates, ['bundle-templates-watch']);
  //gulp.watch(pathToSrc+watchLess, ['copy-css']);
});

gulp.task('serve', ['watch'], function() {
  browserSync.init({
      server: {
          baseDir: pathToDist
      }
  });
});

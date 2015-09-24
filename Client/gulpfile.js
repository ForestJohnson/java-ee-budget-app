
var gulp = require('gulp');
var browserSync = require('browser-sync').create();
var Builder = require('systemjs-builder');
var gulpProtobuf = require('gulp-protobufjs');
var ngAnnotate = require('gulp-ng-annotate');
var templateCache = require('gulp-angular-templatecache');
var less = require('gulp-less');
var concatCss = require('gulp-concat-css');

var pathToDist = '../WebContent/';
var pathToSrc = 'app/';

var html = pathToSrc+'index.html';
var bootstrap = 'jspm_packages/github/twbs/bootstrap@3.3.5/css/bootstrap.css'
var watchJs = pathToSrc+'**/*.js';
var watchLess = pathToSrc+'**/*.less';
var watchTemplates = pathToSrc+'**/*.tmpl.html';
var watchProtobuf = '../protobufs/*.proto';
var outputProtobuf = 'app/protobufs/fakeDir';

// gulp.task('ng-annotate', [], function() {
//   return gulp.src(watchJs)
//       .pipe(ngAnnotate({
//         sourceType: 'module'
//       }))
//       .pipe(gulp.dest(pathToSrc));
// });


gulp.task('bundle-templates', [], function() {
  return gulp.src(watchTemplates)
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
    //minify: true,
	  sourceMaps: true
  })
  .catch(function(err) {
    console.log('Build error');
    console.log(err);
  });
});

gulp.task('protobufs', function () {
  return gulp.src(watchProtobuf)
    .pipe(gulpProtobuf({

    }))
    .pipe(gulp.dest(outputProtobuf));
});

gulp.task('bundle-less', function () {
 return gulp.src(watchLess)
   .pipe(less({

   }))
   .pipe(concatCss("bundle.css"))
   .pipe(gulp.dest(pathToDist))
   .pipe(browserSync.stream());
});

gulp.task('copy-css', [], function() {
  return gulp.src(bootstrap)
        .pipe(gulp.dest(pathToDist));
});

gulp.task('copy-html', [], function() {
  return gulp.src(html)
        .pipe(gulp.dest(pathToDist));
});

gulp.task('copy-js-debug', [], function() {
  return gulp.src('app/**/*.js')
        .pipe(gulp.dest(pathToDist+'Client/app'));
});

gulp.task('build', [
  'copy-html',
  'copy-css',
  'bundle-templates',
  'bundle-less',
  'protobufs',
  'bundle-js',
  'copy-js-debug'
], function(){});

gulp.task('bundle-templates-watch', ['bundle-templates'], browserSync.reload);
gulp.task('copy-html-watch', ['copy-html'], browserSync.reload);
gulp.task('bundle-js-watch', ['bundle-js', 'copy-js-debug'], browserSync.reload);

gulp.task('watch', ['build'], function() {
  gulp.watch(html, ['copy-html-watch']);
  gulp.watch(watchProtobuf, ['protobufs']);
  gulp.watch(watchJs, ['bundle-js-watch']);
  gulp.watch(watchTemplates, ['bundle-templates-watch']);
  gulp.watch(watchLess, ['bundle-less']);
});

gulp.task('serve', ['watch'], function() {
  browserSync.init({
      server: {
          baseDir: pathToDist
      }
  });
});

gulp.task('default', ['serve'], function(){});

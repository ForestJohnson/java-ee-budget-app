
var gulp = require('gulp');
var browserSync = require('browser-sync').create();
var Builder = require('systemjs-builder');
var gulpProtobuf = require('gulp-protobufjs');
var ngAnnotate = require('gulp-ng-annotate');
var templateCache = require('gulp-angular-templatecache');
var less = require('gulp-less');
var concatCss = require('gulp-concat-css');
var del = require('del');

var pathToDist = '../WebContent/';
var pathToSrc = 'app/';
var pathToProtobuf = '../protobufs';

var html = pathToSrc+'index.html';
var bootstrap = 'jspm_packages/github/twbs/bootstrap@3.3.5/css/bootstrap.css'
var angularChartLess = 'jspm_packages/npm/angular-chart.js@0.8.4/angular-chart.less'
var watchJs = pathToSrc+'**/*.js';
var watchLess = [pathToSrc+'**/*.less', angularChartLess];
var watchTemplates = pathToSrc+'**/*.tmpl.html';
var watchProtobuf = pathToProtobuf+'/*.proto';
var outputProtobuf = 'app/protobufs/fakeDir';
 
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

gulp.task('bundle-js', ['bundle-js-copy'], function () {
  return del('../index.js*', {force: true});
});

gulp.task('bundle-js-copy', ['bundle-js-build'], function () {
  return gulp.src('../index.js*')
        .pipe(gulp.dest(pathToDist));
});

gulp.task('bundle-js-build', [], function () {
  var builder = new Builder('./', 'config.js')

  return builder.buildStatic(pathToSrc+'index.js', '../'+'index.js', {
	  runtime: false,
    //minify: true,
	  sourceMaps: true,
    lowResSourceMaps: true
  })
  .catch(function(err) {
    console.log('Build error');
    console.log(err);
  });
});

gulp.task('protobufs', function () {
  return gulp.src(watchProtobuf)
    .pipe(gulpProtobuf({
      path: pathToProtobuf
    }))
    .on('error', console.log)
    .pipe(gulp.dest(outputProtobuf))
    ;
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

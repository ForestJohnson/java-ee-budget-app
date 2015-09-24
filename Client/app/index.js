'use strict';

import angular from 'angular'

import './routes/index'
import './directives/index'

//import templateCache from '../templates'

var app = angular.module('client', [
  'template-cache',
  'client.directives',
  'client.routes'
]);

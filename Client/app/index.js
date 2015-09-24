'use strict';

import angular from 'angular'

import './protobufs/index'
import './routes/index'
import './directives/index'
import './services/index'

//import templateCache from '../templates'

var app = angular.module('client', [
  'template-cache',
  'client.protobufs',
  'client.directives',
  'client.services',
  'client.routes'
]);

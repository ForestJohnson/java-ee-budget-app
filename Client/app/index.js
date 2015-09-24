'use strict';

import angular from 'angular'

import './routes/index'

import templateCache from './templates'

var app = angular.module('client', [
  templateCache.name,
  'client.routes'
]);

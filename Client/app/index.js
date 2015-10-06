'use strict';

import angular from 'angular'
import angularChart from 'angular-chart' 

import './protobufs/protobufs.module'
import './routes/routes.module'
import './directives/directives.module'
import './services/services.module'

var app = angular.module('client', [
  'template-cache',
  'chart.js',
  'client.protobufs',
  'client.directives',
  'client.services',
  'client.routes'
]);

app.value('ApiBaseUrl', 'api/');

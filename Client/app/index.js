'use strict';

import Chart from 'chart'
import angular from 'angular'
import 'angular-ui-router'
import 'angular-chart'

import './protobufs/protobufs.module'
import './routes/routes.module'
import './directives/directives.module'
import './services/services.module'

var app = angular.module('client', [
  'template-cache',
  'ui.router',
  'chart.js',
  'client.protobufs',
  'client.directives',
  'client.services',
  'client.routes'
]);

app.value('ApiBaseUrl', 'api/');

app.value('DefaultChartColors', Chart.defaults.global.colours);

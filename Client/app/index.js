'use strict';

import 'angular-ui-router'
import 'angular-datepicker'
import 'angular-chart'

import './protobufs/protobufs.module'
import './routes/routes.module'
import './directives/directives.module'
import './services/services.module'

var app = angular.module('client', [
  'template-cache',
  'ui.router',
  'chart.js',
  'datePicker',
  'client.protobufs',
  'client.directives',
  'client.services',
  'client.routes'
]);

app.value('ApiBaseUrl', 'http://localhost:8080/Budget/api/');

app.value('DefaultChartColors', Chart.defaults.global.colours);

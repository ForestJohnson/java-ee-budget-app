'use strict';

import RegisterHome from './home.js'

import 'angular-ui-router'
import angular from 'angular'

var routes = angular.module('client.routes', [
  'ui.router',
]);

routes.config(['$stateProvider', '$urlRouterProvider', function($stateProvider, $urlRouterProvider) {
    $urlRouterProvider.otherwise('/');

    RegisterHome($stateProvider, routes);
}]);

export default routes;

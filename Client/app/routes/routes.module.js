'use strict';

import RegisterHome from './home.js'
import RegisterUpload from './upload.js'
import RegisterSort from './sort.js'
import RegisterReports from './reports.js'



var routes = angular.module('client.routes', []);

routes.config(['$stateProvider', '$urlRouterProvider', function($stateProvider, $urlRouterProvider) {
    $urlRouterProvider.otherwise('/');

    RegisterHome($stateProvider, routes);
    RegisterUpload($stateProvider, routes);
    RegisterSort($stateProvider, routes);
    RegisterReports($stateProvider, routes);

}]);

export default routes;

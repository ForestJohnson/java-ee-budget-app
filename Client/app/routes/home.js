'use strict';

/*@ngInject*/
function registerRouteAndController($stateProvider, module) {
  $stateProvider.state(
    'home',
    {
      url: '/',
      templateUrl: 'app/routes/home.tmpl.html',
      controller: 'HomeController',
      controllerAs: 'vm'
    }
  );

  module.controller('HomeController',
  [
    '$scope',
    function HomeController($scope) {
      console.log('loaded HomeController');
    }
  ]);
}

export default registerRouteAndController;

'use strict';

/*@ngInject*/
export default function registerRouteAndController($stateProvider, module) {
  $stateProvider.state(
    'home',
    {
      url: '/',
      templateUrl: 'app/routes/home.tmpl.html',
      controller: [
        '$scope',
        function HomeController($scope) {
          console.log('loaded HomeController');
        }
      ],
      controllerAs: 'vm'
    }
  );

  // module.controller('HomeController',
  // );
}

registerRouteAndController;

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
          this.transactions = []; 
        }
      ],
      controllerAs: 'vm'
    }
  );

  // module.controller('HomeController',
  // );
}

registerRouteAndController;

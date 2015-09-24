'use strict';

var HomeController = ['$scope', 'TestBuilder',
function HomeController($scope, TestBuilder) {
  this.transactions = [];

}];

export default function registerRouteAndController($stateProvider, module) {
  $stateProvider.state(
    'home',
    {
      url: '/',
      templateUrl: 'app/routes/home.tmpl.html',
      controller: HomeController,
      controllerAs: 'vm'
    }
  );
}

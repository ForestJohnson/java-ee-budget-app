'use strict';

var HomeController = ['$scope', 'TransactionList', 'RestService',
function HomeController($scope, TransactionList, RestService) {
  this.transactionList = new TransactionList({});
  this.transactionList.loading = true;

  RestService.getRecentTransactions()
    .then((response) => {
      this.transactionList = response.data;
    });

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

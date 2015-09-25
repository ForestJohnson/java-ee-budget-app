'use strict';

var HomeController = ['$scope', 'Transaction', 'EventService',
function HomeController($scope, Transaction, EventService) {
  this.transactions = [];

  this.testPost = () => {
    EventService.postTest(new Transaction({transactionId:1}))
    .then((response) => {
      console.log(Transaction.decode(response.data));
    }); 
  };

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

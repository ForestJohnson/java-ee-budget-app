'use strict';

var HomeController = ['TransactionList', 'Filter', 'DateRangeFilter', 'RestService',
function HomeController(TransactionList, Filter, DateRangeFilter, RestService) {

  this.transactionList = new TransactionList({
    filters: [
      new Filter({
        dateRangeFilter: new DateRangeFilter({
          start: new Date().getTime() - 1000*60*60*24*30*12*3,
          end: new Date().getTime()
        })
      })
    ]
  });

  RestService.getRecentTransactions(this.transactionList)
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

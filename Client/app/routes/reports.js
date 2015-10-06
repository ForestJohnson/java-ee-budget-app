'use strict';

var ReportsController = ['RestService',
function ReportsController(RestService) {

  RestService.getRecentTransactions()
    .then((response) => {
      this.transactionList = response.data;
    });

}];

export default function registerRouteAndController($stateProvider, module) {
  $stateProvider.state(
    'reports',
    {
      url: '/',
      templateUrl: 'app/routes/reports.tmpl.html',
      controller: ReportsController,
      controllerAs: 'vm'
    }
  );
}

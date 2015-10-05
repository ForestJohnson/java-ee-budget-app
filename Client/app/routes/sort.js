'use strict';

var SortController = ['UnsortedTransaction', 'RestService',
function SortController(UnsortedTransaction, RestService) {
  this.toSort = new UnsortedTransaction({});
  this.toSort.loading = true;

  RestService.getUnsortedTransaction()
    .then((response) => {
      this.toSort = response.data;
    });

}];

export default function registerRouteAndController($stateProvider, module) {
  $stateProvider.state(
    'sort',
    {
      url: '/sort',
      templateUrl: 'app/routes/sort.tmpl.html',
      controller: SortController,
      controllerAs: 'vm'
    }
  );
}

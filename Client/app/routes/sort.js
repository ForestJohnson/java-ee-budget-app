'use strict';

var SortController = ['UnsortedTransaction', 'Event', 'SortTransactionEvent', 'RestService', 'FormatHelper',
                      'TransactionCategory', '$state',
function SortController(UnsortedTransaction, Event, SortTransactionEvent, RestService, FormatHelper,
                        TransactionCategory, $state) {
  this.toSort = new UnsortedTransaction({});
  this.toSort.loading = true;
  this.event = {
    date: new Date().getTime(),
    sortTransactionEvent: {}
  };
  this.sortEvent = this.event.sortTransactionEvent;
  this.formatter = FormatHelper;
  this.newTransactionType = new TransactionCategory({});

  RestService.getUnsortedTransaction()
    .then((response) => {
      this.toSort = response.data;
      this.sortEvent.transaction = response.data.transaction;
      this.sortEvent.category = this.toSort.categories[0];
    });

  this.clearSelectedTransactionType = () => {
    this.sortEvent.category = null;
  };

  this.nameAlreadyExists = () => {
    return this.toSort.categories.some(
           (category) => category.name == this.newTransactionType.name
         );
  };

  this.getStyleForCategory = (category) => {
    return {
      backgroundColor: category && category.color ? this.formatter.formatColor(category.color) : '#dddddd'
    };
  };

  this.addTransactionType = () => {
    this.toSort.categories.push(TransactionCategory.decode(this.newTransactionType.encodeAB()));
    this.sortEvent.category = this.toSort.categories[this.toSort.categories.length-1];
    this.newTransactionType.name = '';
  };

  this.submitTransactionType = () => {
    RestService.sortTransaction(new Event(this.event))
      .then(() => {
        $state.go('sort', {}, {reload: true, inherit: false});
      });
  };

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

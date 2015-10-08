'use strict';

import tinycolor from 'tinycolor'

var SortController = ['UnsortedTransaction', 'Event', 'SortTransactionEvent', 'RestService', 'FormatHelper',
                      'TransactionCategory', '$state',
function SortController(UnsortedTransaction, Event, SortTransactionEvent, RestService, FormatHelper,
                        TransactionCategory, $state) {
  this.submitted = false;
  this.goldenRatio = 1.61803;
  this.nonCorrelatedSineFudgeFactor = 0.6934;
  this.toSort = new UnsortedTransaction({});
  this.toSort.loading = true;
  this.event = {
    date: new Date().getTime(),
    sortTransactionEvent: {}
  };
  this.sortEvent = this.event.sortTransactionEvent;
  this.formatter = FormatHelper;
  this.newTransactionCategory = new TransactionCategory({
    color:{
    }
  });

  RestService.getUnsortedTransaction()
    .then((response) => {
      this.toSort = response.data;
      this.setNextCategoryColor();
      this.sortEvent.transaction = response.data.transaction;
      this.sortEvent.category = this.toSort.categories[0];
    });

  this.clearSelectedTransactionType = () => {
    this.sortEvent.category = null;
  };

  this.addCategoryDisallowed = () => {
    return !this.newTransactionCategory.name
        || this.toSort.categories.some(
           (category) => category.name == this.newTransactionCategory.name
         );
  };

  this.addTransactionType = () => {
    this.toSort.categories.push(angular.extend({}, this.newTransactionCategory));
    this.sortEvent.category = this.toSort.categories[this.toSort.categories.length-1];
    this.newTransactionCategory.name = '';
    this.setNextCategoryColor();
    this.submitTransactionType();
  };

  this.setNextCategoryColor = () => {
    var colorId = this.toSort.categories.length+1;
    var fluctuation = Math.sin(this.nonCorrelatedSineFudgeFactor*colorId);
    var slowFluctuation = Math.sin(this.nonCorrelatedSineFudgeFactor*this.goldenRatio*colorId);

    this.newTransactionCategory.color.h = (this.goldenRatio * colorId) % 1;
		this.newTransactionCategory.color.s = 0.65 + fluctuation*0.3;
    this.newTransactionCategory.color.v = 0.7 + slowFluctuation*0.3;
  }

  this.submitTransactionType = () => {
    if(!this.submitted) {
      this.submitted = true;
      RestService.sortTransaction(new Event(this.event))
        .then(() => {
          $state.go('sort', {}, {reload: true, inherit: false});
        });
    }
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

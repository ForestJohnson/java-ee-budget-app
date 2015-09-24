"use strict";

export default function registerDirective(module) {
  module.directive(
    'transactionList',
    function transactionList() {
      return {
        restrict: 'E',
        templateUrl: "app/shared/transactionList/transactionList.tmpl.html",
        controllerAs: "vm",
        controller: [function() {
          this.getDateString = (date) => 'null';
          this.getDollarsString = (dollars) => 'null';
          this.getDescriptionString = (transaction) => 'null';
        }],
        bindToController: true,
        scope: {
          transactions: '='
        }
      }
    }
  );
}
  

"use strict";

export default function registerDirective(module) {
  module.directive(
    'transactionList',
    function transactionList() {
      return {
        restrict: 'E',
        templateUrl: "app/directives/transactionList/transactionList.tmpl.html",
        controllerAs: "vm",
        controller: ['FormatHelper', function(FormatHelper) {
          var FormatHelper = FormatHelper;
          this.getDateString = (dateMs) => FormatHelper.formatDate(new Date(dateMs));
          this.getDollarsString = (dollars) => '$'+Math.abs(dollars).toFixed(2);
        }],
        bindToController: true,
        scope: {
          list: '=',
          editable: '@?'
        }
      }
    }
  );
}

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
          this.formater = FormatHelper;
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

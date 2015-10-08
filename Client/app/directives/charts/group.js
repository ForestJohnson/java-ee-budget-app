"use strict";

export default function registerDirective(module) {
  module.directive(
    'ilmGroupChart',
    function ilmDoughnutChart() {
      return {
        restrict: 'AE',
        template: [
          '<canvas class="chart chart-base"',
          '  chart-type="c.type"',
          '  chart-data="c.data"',
          '  chart-labels="c.labels"',
          '  chart-legend="true"',
          '  chart-colours="c.colors"',
          '  chart-options="c.options">',
          '</canvas>'
        ].join('\n'),
        controllerAs: "c",
        controller: ['FormatHelper', '$scope', function(FormatHelper, $scope) {

          var self = this;
          var empty = [];
          $scope.$watch(
            () => self.datagroup ? self.datagroup : empty,
            (newValue) => {
              self.data = newValue.map((d) => FormatHelper.centsToDollars(Math.abs(d.cents)));
              self.labels = newValue.map((d) => d.category.name);
              self.colors = newValue.map((d) => FormatHelper.formatColor(d.category.color));
            }
          );

          self.options = {
            animationSteps : 25,
            animateRotate : false,
            animateScale : true,
          };
        }],
        bindToController: true,
        scope: {
          datagroup: '=',
          type: '@'
        }
      }
    }
  );
}

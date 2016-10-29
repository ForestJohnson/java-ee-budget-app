"use strict";

export default function registerDirective(module) {
  module.directive(
    'ilmSeriesChart',
    function ilmDoughnutChart() {
      return {
        restrict: 'AE',
        template: [
          '<canvas class="chart chart-base"',
          '  chart-type="c.type"',
          '  chart-data="c.data"',
          '  chart-labels="c.labels"',
          '  chart-series="c.series"',
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
            () => self.dataseries ? self.dataseries : empty,
            (newValue) => {

              self.data = [];
              newValue.forEach(
                (step, stepId) => step.data.forEach(
                  (d, seriesId) => {
                    if(!self.data[seriesId]) {
                      self.data[seriesId] = [];
                    }
                    var value = d.cents;
                    if(self.abs == "true") {
                      value = Math.abs(value);
                    }
                    if(self.unit == "$") {
                      self.data[seriesId][stepId] = FormatHelper.centsToDollars(value);
                    } else {
                      self.data[seriesId][stepId] = Math.round(value*100)/100;
                    }

                  }
                )
              );
              self.labels = newValue.map((step) => {
                if(step.filters[0]) {
                  var date = new Date(step.filters[0].dateRangeFilter.start.toNumber());
                  return FormatHelper.getMonthYear(date);
                } else {
                  return 'null';
                }
              });
              if(newValue[0]) {
                self.series = newValue[0].data.map((d) => d.category.name);
                self.colors = newValue[0].data.map((d) => FormatHelper.formatColor(d.category.color));
              }

            }
          );

          self.options = {
            animationSteps : 25
          };
        }],
        bindToController: true,
        scope: {
          dataseries: '=',
          abs: '@',
          unit: '@',
          type: '@'
        }
      }
    }
  );
}

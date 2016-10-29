'use strict';



var ReportsController = ['$scope', 'RestService', 'ReportDataGroup', 'ReportDataSeries',
                          'Filter', 'DateRangeFilter', 'DefaultChartColors', 'ReportDataPoint',
function ReportsController($scope, RestService, ReportDataGroup, ReportDataSeries,
                            Filter, DateRangeFilter, DefaultChartColors, ReportDataPoint) {
  var self = this;

  self.spendingByCategory = new ReportDataGroup({});
  self.summary = new ReportDataGroup({});
  self.series = new ReportDataSeries({});
  self.savingsRate = new ReportDataSeries({});
  self.incomeSpending = new ReportDataSeries({});

  self.monthMs = 1000*60*60*24*31;
  self.startDate = new Date(new Date().getTime() - self.monthMs * 12);
  self.endDate = new Date();

  self.dateRange = new DateRangeFilter({
    start: self.startDate.getTime(),
    end: self.endDate.getTime()
  });

  $scope.$watch(
    () => String(self.startDate.getTime())+String(self.endDate.getTime()),
    () => {
      self.dateRange.start = self.startDate.getTime();
      self.dateRange.end = self.endDate.getTime();
      self.reloadReport();
    }
  );

  self.reloadReport = () => {
    if(self.loading) {
      return;
    }
    self.loading = true;
    RestService.dataSeries(self.dateRange, self.monthMs)
      .then((response) => {
        self.loading = false;

        var seriesData = response.data.series;

        var aggregateData = []
        seriesData.forEach((step) => {
          step.data.forEach((p, i) => {
            if(!aggregateData[i]) {
              aggregateData[i] = angular.extend({}, p);
            } else {
              aggregateData[i].cents += p.cents;
            }
          });
        });

        self.spendingByCategory.data = aggregateData
          .filter((d) => d.category.name.toLowerCase().indexOf('debtrepayment') == -1)
          .filter((d) => d.cents < 0);
        self.summary.data = summarize(aggregateData);

        self.series.data = seriesData.map((step) => {
          return {
            data: summarize(step.data),
            filters: step.filters
          };
        });

        self.savingsRate.data = seriesData.map((step) => {
          return {
            data: getSavingsRate(step.data),
            filters: step.filters
          };
        });



        self.incomeSpending.data = seriesData.map((step) => {
          return {
            data: getIncomeSpending(step.data),
            filters: step.filters
          };
        });

        var totals = self.incomeSpending.data.reduce(
          (totals, x) => {
            totals.income +=  x.data[0].cents;
            totals.spending +=  x.data[1].cents;
            return totals;
          },
          {income:0,spending:0}
        );
        self.avgSavingsRate = Math.round(((totals.income-totals.spending)/totals.income)*100)+'%';

        function getSavingsRate (data) {
          var spending = data.filter((d) => d.category.name.toLowerCase().indexOf('debt') == -1)
            .filter((d) => d.cents < 0);
          var income = data.filter((d) => d.cents > 0);

          var totalSpending = spending
            .reduce((total, d) => total + Math.abs(d.cents), 0);
          var totalIncome = income
            .reduce((total, d) => total + Math.abs(d.cents), 0);

          var savingsRate = ((totalIncome-totalSpending)/totalIncome)*100;

          return [
            {
              category: {
                color: DefaultChartColors[0],
                name: 'SavingsRate'
              },
              cents: totalIncome == 0 ? 0 : savingsRate
            }
          ];
        };

        function getIncomeSpending (data) {
          return [
            {
              category: {
                color: DefaultChartColors[0],
                name: 'Income'
              },
              cents: data.filter((d) => d.cents > 0)
                .reduce((total, d) => total + Math.abs(d.cents), 0)
            },
            {
              category: {
                color: DefaultChartColors[2],
                name: 'Spending'
              },
              cents: data.filter((d) => d.category.name.toLowerCase().indexOf('debt') == -1)
                .filter((d) => d.cents < 0)
                .reduce((total, d) => total + Math.abs(d.cents), 0)
            }
          ];
        };

        function summarize (data) {
          var spending = data.filter((d) => d.cents < 0);
          var income = data.filter((d) => d.cents > 0);

          var totalDebtRepayment = spending
            .filter((d) => d.category.name.toLowerCase().indexOf('debt') != -1)
            .reduce((total, d) => total + Math.abs(d.cents), 0);

          var totalCreditExtended = spending
            .filter((d) => d.category.name.toLowerCase().indexOf('credit') != -1)
            .reduce((total, d) => total + Math.abs(d.cents), 0);

          var totalSpending = spending
            .reduce((total, d) => total + Math.abs(d.cents), 0)
            - (totalDebtRepayment + totalCreditExtended);

          var totalSavings = income
            .reduce((total, d) => total + Math.abs(d.cents), 0)
            - (totalDebtRepayment + totalCreditExtended + totalSpending);

          return [
            {
              category: {
                color: DefaultChartColors[2],
                name: 'Spending'
              },
              cents: totalSpending
            },
            {
              category: {
                color: DefaultChartColors[4],
                name: 'Credit Extended'
              },
              cents: totalCreditExtended
            },
            {
              category: {
                color: DefaultChartColors[0],
                name: 'Savings'
              },
              cents: totalSavings
            },
            {
              category: {
                color: DefaultChartColors[3],
                name: 'Debt Repayment'
              },
              cents: totalDebtRepayment
            }
          ];
        }


      });
  };

  self.reloadReport();

}];

export default function registerRouteAndController($stateProvider, module) {
  $stateProvider.state(
    'reports',
    {
      url: '/reports',
      templateUrl: 'app/routes/reports.tmpl.html',
      controller: ReportsController,
      controllerAs: 'vm'
    }
  );
}

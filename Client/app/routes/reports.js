'use strict';



var ReportsController = ['$scope', 'RestService', 'ReportDataGroup', 'ReportDataSeries',
                          'Filter', 'DateRangeFilter', 'DefaultChartColors',
function ReportsController($scope, RestService, ReportDataGroup, ReportDataSeries,
                            Filter, DateRangeFilter, DefaultChartColors) {
  var self = this;

  self.spendingByCategory = new ReportDataGroup({});
  self.summary = new ReportDataGroup({});

  self.startDate = new Date(new Date().getTime() - 1000*60*60*24*31);
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
    RestService.dataGroup(self.dateRange)
      .then((response) => {
        self.loading = false;

        var data = response.data.data;
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

        self.spendingByCategory.data = spending;

        self.summary.data = [
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

'use strict';



var ReportsController = ['RestService', 'ReportDataGroup', 'ReportDataSeries',
                          'Filter', 'DateRangeFilter', 'DefaultChartColors',
function ReportsController(RestService, ReportDataGroup, ReportDataSeries,
                            Filter, DateRangeFilter, DefaultChartColors) {

  this.spendingByCategory = new ReportDataGroup({});
  this.summary = new ReportDataGroup({});

  RestService.dataGroup(this.spendingByCategory)
    .then((response) => {
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

      this.spendingByCategory.data = spending;

      this.summary.data = [
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

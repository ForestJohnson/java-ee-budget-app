'use strict';

import registerTransactionList from './transactionList/transactionList'
import registerGroupChart from './charts/group'
import registerSeriesChart from './charts/series'

var module = angular.module('client.directives', []);

registerTransactionList(module);
registerGroupChart(module);
registerSeriesChart(module);

export default module;

'use strict';

import angular from 'angular'

import registerTransactionList from './transactionList/transactionList'
import registerDoughnutChart from './charts/doughnut'

var module = angular.module('client.directives', []);

registerTransactionList(module);
registerDoughnutChart(module);

export default module;

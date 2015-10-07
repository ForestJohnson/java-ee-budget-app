'use strict';

import angular from 'angular'

import registerTransactionList from './transactionList/transactionList'
import registerGroupChart from './charts/group'

var module = angular.module('client.directives', []);

registerTransactionList(module);
registerGroupChart(module);

export default module;

'use strict';

import angular from 'angular'
 
import registerTransactionList from './transactionList/transactionList'

var module = angular.module('client.directives', []);

registerTransactionList(module);

export default module;

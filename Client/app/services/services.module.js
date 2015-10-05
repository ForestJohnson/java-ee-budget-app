'use strict';

import angular from 'angular'

import registerRestService from './RestService.js'
import registerFormatHelper from './FormatHelper.js'

//import registerTransactionList from './transactionList/transactionList'

var module = angular.module('client.services', []);

registerRestService(module);
registerFormatHelper(module);

export default module;

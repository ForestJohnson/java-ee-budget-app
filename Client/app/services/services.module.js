'use strict';

import angular from 'angular'

import registerEventService from './eventService.js'

//import registerTransactionList from './transactionList/transactionList'

var module = angular.module('client.services', []);

registerEventService(module);

export default module;

'use strict';

import registerDragAndDropFile from './dragAndDropFile/dragAndDropFile'
import registerTransactionList from './transactionList/transactionList'
import registerGroupChart from './charts/group'
import registerSeriesChart from './charts/series'

var module = angular.module('client.directives', []);

registerDragAndDropFile(module);
registerTransactionList(module);
registerGroupChart(module);
registerSeriesChart(module);

export default module;

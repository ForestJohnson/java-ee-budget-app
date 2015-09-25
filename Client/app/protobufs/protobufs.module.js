'use strict';

import Data from './Client/Data.proto.js'
import Events from './Client/Events.proto.js'
import Views from './Client/Views.proto.js'

var protobufs = angular.module('client.protobufs', []);

protobufs.value('Transaction', Data.com.ilmservice.personalbudget.Transaction);
protobufs.value('UploadSpreadsheetEvent', Events.com.ilmservice.personalbudget.UploadSpreadsheetEvent);
protobufs.value('TransactionList', Views.com.ilmservice.personalbudget.TransactionList);

export default protobufs;

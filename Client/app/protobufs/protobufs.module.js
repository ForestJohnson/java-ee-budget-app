'use strict';

import Data from './Client/Data.proto.js'
import Events from './Client/Events.proto.js'
import Views from './Client/Views.proto.js'

var protobufs = angular.module('client.protobufs', []);

protobufs.value('Transaction', Data.com.ilmservice.personalbudget.Transaction);
protobufs.value('Event', Events.com.ilmservice.personalbudget.Event);
protobufs.value('UploadSpreadsheetEvent', Events.com.ilmservice.personalbudget.UploadSpreadsheetEvent);
protobufs.value('SpreadsheetRow', Events.com.ilmservice.personalbudget.SpreadsheetRow);
protobufs.value('TransactionList', Views.com.ilmservice.personalbudget.TransactionList);
protobufs.value('Filter', Views.com.ilmservice.personalbudget.Filter);
protobufs.value('DateRangeFilter', Views.com.ilmservice.personalbudget.DateRangeFilter);
protobufs.value('UnsortedTransaction', Views.com.ilmservice.personalbudget.UnsortedTransaction);

export default protobufs;

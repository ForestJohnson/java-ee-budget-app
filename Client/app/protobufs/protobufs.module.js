'use strict';

import Data from './Client/Data.proto.js'
import Events from './Client/Events.proto.js'
import Views from './Client/Views.proto.js'

var protobufs = angular.module('client.protobufs', []);

protobufs.value('Transaction', Data.Transaction);
protobufs.value('UploadSpreadsheetEvent', Events.UploadSpreadsheetEvent);
protobufs.value('TransactionList', Views.TransactionList);

export default protobufs;

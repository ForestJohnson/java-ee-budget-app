'use strict';

import papaparse from 'papaparse'


var UploadController = ['$state', 'TransactionList', 'Event', 'UploadSpreadsheetEvent',
                         'SpreadsheetRow', 'RestService',
function UploadController($state, TransactionList, Event, UploadSpreadsheetEvent,
                          SpreadsheetRow, RestService) {
  var TransactionList = TransactionList;
  var UploadSpreadsheetEvent = UploadSpreadsheetEvent;
  var SpreadsheetRow = SpreadsheetRow;
  var Event = Event;

  this.transactionList = new TransactionList({});
  this.csvString = '';

  this.uploadSpreadsheet = (dataTransfer) => {

    if(dataTransfer.files.length > 1) {
      throw new Error("ERROR: ONLY SUPPORTS ONE FILE AT A TIME");
    }
    Array.prototype.forEach.call(dataTransfer.files, file => {
      var reader = new FileReader();
      reader.readAsText(file);
      reader.onload = (resultEvent) => {
        var spreadsheetEvent = csvToSpreadsheetEvent(resultEvent.target.result);
        if(spreadsheetEvent) {
          RestService.postSpreadsheetEvent(spreadsheetEvent)
            .then((response) => {
              this.transactionList = response.data;
            });
        }
      };
      reader.onerror = (errorEvent) => {
        throw new Error("ERROR:  FILE READ ERROR " + errorEvent);
      };
    });

  };

  this.postAllTransactions = () => {
    RestService.postAllTransactions(this.transactionList)
      .then((response) => {
        $state.go('sort');
      });
  };

  function csvToSpreadsheetEvent(csvString) {
    var parseResult = papaparse.parse(csvString);

    if(parseResult.errors.length == 0) {
      return new Event({
        date: new Date().getTime(),
        uploadSpreadsheetEvent: new UploadSpreadsheetEvent({
          rows: parseResult.data.map((stringArray, i) => new SpreadsheetRow({
            fields: stringArray,
            index: i
          }))
        })
      });
    } else {
      alert(parseResult.errors.map(
        (error) => (error.code + ': ' + error.message + (error.row ? ' at row: ' + row : ''))
      ));
    }
  }
}];

export default function registerRouteAndController($stateProvider, module) {
  $stateProvider.state(
    'upload',
    {
      url: '/upload',
      templateUrl: 'app/routes/upload.tmpl.html',
      controller: UploadController,
      controllerAs: 'vm'
    }
  );
}

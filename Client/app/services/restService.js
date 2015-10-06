
let RestService = [
        '$http', 'ApiBaseUrl', 'TransactionList', 'Filter', 'DateRangeFilter', 'UnsortedTransaction',
function ($http, ApiBaseUrl, TransactionList, Filter, DateRangeFilter, UnsortedTransaction) {

  this.getRecentTransactions = (list) => {
    list.loading = true;
    return protobufHTTP('POST', 'listTransactions', TransactionList, list);
  };

  this.postSpreadsheetEvent = (spreadsheetEvent) => {
    return protobufHTTP('POST', 'spreadsheet', TransactionList, spreadsheetEvent);
  };

  this.postAllTransactions = (transactionList) => {
    return protobufHTTP('POST', 'postTransactions', null, transactionList);
  };

  this.getUnsortedTransaction = () => {
    return protobufHTTP('GET', 'getUnsortedTransaction', UnsortedTransaction);
  };

  this.sortTransaction = (event) => {
    return protobufHTTP('POST', 'sortTransaction', null, event);
  };

  this.reports = (reportQuery) => {
    return protobufHTTP('POST', 'sortTransaction', null, reportQuery);
  };

  function protobufHTTP (method, url, type, protocolBuffer) {
    var toReturn = $http({
      method: method,
      url: ApiBaseUrl+url,
      headers: {
        'Content-Type': 'application/x-protobuf'
      },
      responseType: "arraybuffer",
      data: protocolBuffer ? new Uint8Array(protocolBuffer.encodeAB()) : undefined,
      transformRequest: []
    });

    if(type) {
      toReturn = toReturn.then((response) => {
        response.data = type.decode(response.data);
        return response;
      });
    }

    return toReturn;
  }

}];

export default function registerService (module) {
  module.service('RestService', RestService);
}


let RestService = [
        '$http', 'ApiBaseUrl', 'TransactionList', 'Filter', 'DateRangeFilter',
function ($http, ApiBaseUrl, TransactionList, Filter, DateRangeFilter) {

  this.getRecentTransactions = () => {
    return protobufHTTP('POST', 'transactions', TransactionList,
      new TransactionList({
        filters: [
          new Filter({
            dateRangeFilter: new DateRangeFilter({
              start: new Date().getTime() - 1000*60*60*24*30,
              end: new Date().getTime()
            })
          })
        ]
      }));
  };

  this.postSpreadsheetEvent = (spreadsheetEvent) => {
    return protobufHTTP('POST', 'spreadsheet', TransactionList, spreadsheetEvent);
  };

  function protobufHTTP (method, url, type, protocolBuffer) {
    return $http({
      method: method,
      url: ApiBaseUrl+url,
      headers: {
        'Content-Type': 'application/x-protobuf'
      },
      responseType: "arraybuffer",
      data: protocolBuffer ? new Uint8Array(protocolBuffer.encodeAB()) : undefined,
      transformRequest: []
    }).then((response) => {
      response.data = type.decode(response.data);
      return response;
    });
  }

}];

export default function registerService (module) {
  module.service('RestService', RestService);
}

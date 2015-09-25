
let EventService = ['$http', 'ApiBaseUrl', function ($http, ApiBaseUrl) {
  this.postTest = (protocolBuffer) => {
    return $http({
      method: 'POST',
      url: ApiBaseUrl+'event',
      headers: {
        'Content-Type': 'application/x-protobuf'
      },
      responseType: "arraybuffer",
      data: new Uint8Array(protocolBuffer.encodeAB()),
      transformRequest: []
    });
  };
}];

export default function registerService (module) {
  module.service('EventService', EventService);
}

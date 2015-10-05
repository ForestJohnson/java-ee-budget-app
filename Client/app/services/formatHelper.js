

let FormatHelper = function () {
  this.formatDate = (date) => {
    function pad(number) {
      if (number < 10) {
        return '0' + number;
      }
      return number;
    }

    return date.getUTCFullYear() +
      '-' + pad(date.getUTCMonth() + 1) +
      '-' + pad(date.getUTCDate()) +
      ' ' + pad(date.getUTCHours()) +
      ':' + pad(date.getUTCMinutes());
  };
};

export default function registerService (module) {
  module.service('FormatHelper', FormatHelper);
}

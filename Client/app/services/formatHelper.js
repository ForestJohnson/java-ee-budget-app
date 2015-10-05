
import tinycolor from 'tinycolor'

let FormatHelper = function () {

  this.formatColor = (color) => {
    debugger;
  };

  this.formatCents = (cents) => '$'+Math.abs(cents*0.01).toFixed(2);

  this.formatDate = (dateLong) => {
    if(!dateLong || !dateLong.toNumber) {
      return 'not a long';
    }
    let date = new Date(dateLong.toNumber());

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

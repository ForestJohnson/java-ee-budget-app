'use strict';

import Restart from './Client/Restart.proto.js'

var protobufs = angular.module('client.protobufs', []);

protobufs.value('TestBuilder', Restart.Test); 

export default protobufs;

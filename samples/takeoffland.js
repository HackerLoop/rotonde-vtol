'use strict';

var skybot = require('../skybot');
var helper = skybot.helper;

function onReady(client) {
  skybot.waitIdle()
  .then(helper.start)
  .then(skybot.land)
  .then(helper.stop('done'), helper.stop('error'))
  .then(process.exit);
}

function onError(errors) {
  console.log(errors);
}

skybot.onReady(onReady, onError);

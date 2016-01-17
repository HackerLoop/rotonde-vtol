'use strict';

var skybot = require('../skybot');
var helper = skybot.helper;

/**
 * this the function that should be implemented by the developper
 */

function onReady(client) {
  skybot.waitIdle()
  .then(helper.start)
  .then(helper.loiter(0, 0, 5, 2000))
  .then(helper.go(Math.random() * 180, Math.random() * 360))
  .then(skybot.land)
  .then(helper.stop('done'), helper.stop('error'));
}

function onError(errors) {
  console.log(errors);
}

skybot.onReady(onReady, onError);

/**
 *  Example using es7 await feature
 */
/*
function onReady() {
  try {
    await skybot.waitIdle();

    skybot.start();

    await skybot.takeOff(0, 0, 5, 2000);

    await skybot.go(Math.random() * 180, Math.random() * 360);

    await skybot.land();

    skybot.reset();
    skybot.stop();
    console.log('done');
  } catch() {
    skybot.reset();
    skybot.stop();
    console.log('error');
  }
}
*/

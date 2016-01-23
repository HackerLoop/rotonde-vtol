'use strict';

const _ = require('lodash');

const newClient = require('rotonde-client/src/Client');

let status = {};

/**
 * control functions
 */

module.exports.start = () => {
  running = true;
  sendPing();
}

module.exports.stop = () => {
  running = false;
}

module.exports.waitIdle = () => {
  return new Promise(function(resolve, reject) {
    if (status.state == 'IDLE') {
      resolve();
      return;
    }
    nextPromise = {
      wantsState: 'IDLE',
      resolve: resolve,
      reject: reject,
    }
  });
}

module.exports.takeOff = () => {
  console.log('takeOff');

  client.sendAction('VTOL_TAKEOFF', {});
  return new Promise(function(resolve, reject) {
    nextPromise = {
      wantsState: 'WAITING',
      afterState: 'TAKINGOFF',
      resolve: resolve,
      reject: reject,
    }
  });
}

module.exports.land = () => {
  console.log('land');

  client.sendAction('VTOL_LAND', {});
  return new Promise(function(resolve, reject) {
    nextPromise = {
      wantsState: 'IDLE',
      afterState: 'LANDING',
      resolve: resolve,
      reject: reject,
    }
  });
}

module.exports.loiter = (forward, left, up, duration) => {
  console.log('loiter ', forward, left, up);

  client.sendAction('VTOL_LOITER', {
    duration,
    forward,
    left,
    up,
  });

  return new Promise((resolve, reject) => {
    nextPromise = {
      wantsState: 'WAITING',
      afterState: 'LOITERING',
      resolve,
      reject,
    }
  });
}

module.exports.go = function(latitude, longitude) {
  console.log('go ', latitude, longitude);

  client.sendAction('VTOL_GOTO', {
    latitude: latitude,
    longitude: longitude,
  });
  return new Promise(function(resolve, reject) {
    nextPromise = {
      wantsState: 'WAITING',
      afterState: 'GOINGTO',
      resolve: resolve,
      reject: reject,
    }
  });
}

/**
 *  Helpers
 */

module.exports.helper = {};
module.exports.helper.loiter = function(forward, left, up, duration) {
  return () => {return module.exports.loiter(forward, left, up, duration)};
}

module.exports.helper.go = function(latitude, longitude) {
  return () => {return module.exports.go(latitude, longitude)};
}

module.exports.helper.start = () => {
  module.exports.start();
  return module.exports.takeOff();
}

module.exports.helper.stop = function(reason) {
  return function(e) {
    console.log('stopped ' + reason, ' ', e || '');
    module.exports.stop();
  };
}

/**
 *  Utils
 */

function waiting() {
  return status.state == 'WAITING';
}

function idle() {
  return status.status == 'IDLE' && status.state == 'IDLE';
}

/**
 *  Connection configuration and initialization
 */

// TODO there is a problem with having the client initialization in the module's abstraction,
// this approach prevents having multiple module's abstaction to run in the same user module.
// We chose to leave this for later, as a more global solution might arise.
const client = newClient('ws://192.168.1.123:4224/');

module.exports.onReady = function(onReady, onError, uavNames) {
  uavNames = uavNames || [];

  client.unDefinitionHandlers.attach('*', (u) => {
    if (_.includes(['VTOL_GET_STATUS', 'VTOL_STATUS'], u.identifier)) {
      process.exit();
    }
  });

  client.onReady(() => {

    client.bootstrap({'VTOL_GET_STATUS': {}}, ['VTOL_STATUS'], [], 5000).then(
      (values) => {
        status = values[0].data;

        client.eventHandlers.attach('VTOL_STATUS', (e) => {
          const updated = !_.isEqual(status, e.data);
          status = e.data;
          if (updated) {
            onUpdate();
          }
        });

        console.log('Started');
        onReady(client);
      },
      (errors) => {
        onError(errors);
        process.exit();
      }
    );

  });
  client.connect();
};

/**
 *  change listeners
 */

let nextPromise;/* = {
  wantsState: '',
  afterState: '',
  resolve: function(){},
  reject: function(){},
}*/

function onUpdate() {
  if (nextPromise) {
    let tmp = nextPromise;
    if (tmp.wantsState == status.state) { // we reached the desired state:)
      nextPromise = null;
      tmp.resolve();
    } else if (!_.isUndefined(tmp.afterState) && tmp.afterState !== status.state && tmp.started) { // something is abnormal, we should have either wantsState or afterState as a state
      nextPromise = null;
      tmp.reject();
      console.log('reject ' + JSON.stringify(tmp) + ' ' + JSON.stringify(status));
    } else if (!_.isUndefined(tmp.afterState) && tmp.afterState == status.state) {
      if (!tmp.started) {
        console.log('Started: ' + tmp.afterState);
      }
      tmp.started = true;
    } // TODO we need a timeout for nextPromises that don't have an afterState field, and when afterState is never reached
  }
}

let running = false;
function sendPing() {
  client.sendAction('VTOL_PING', {});
  if (!running)
    return;
  setTimeout(sendPing, 400);
}

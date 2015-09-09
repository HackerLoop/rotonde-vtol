'use strict';

var _ = require('lodash');

var UAVWatcher = require('./uavwatcher');
var Client = require('skybot-client');

var uavwatcher;

/**
 *  SkybotControl constants
 */

var UAV_NAME = 'SkybotControl';
var SKYBOT_ID = 42424242;
var UAV_STATUS_NAME = 'SkybotControlStatus';
var SKYBOT_STATUS_ID = 24242424;

var statuses = {
  IDLE: 'IDLE',
  CONNECTED: 'CONNECTED',
  ERROR: 'ERROR',
};

var states = {
  IDLE: 'IDLE',
  TAKINGOFF: 'TAKINGOFF',
  LANDING: 'LANDING',
  LOITERING: 'LOITERING',
  WAITING: 'WAITING',
  GOINGTO: 'GOINGTO',
  ERROR: 'ERROR',
};

var controlTypes = {
  LOITER: 'LOITER',
  GOTO: 'GOTO',
  IDLE: 'IDLE',
};

/**
 * control functions
 */

module.exports.start = function() {
  running = true;
  sendSkybotControl();
}

module.exports.stop = function() {
  running = false;
}

module.exports.reset = function() {
  uavwatcher.resetUAV(SKYBOT_ID);
}

module.exports.waitIdle = function() {
  return new Promise(function(resolve, reject) {
    var skybotStatusValue = uavwatcher.valueForUAV(SKYBOT_STATUS_ID);
    if (skybotStatusValue.state == statuses.IDLE) {
      resolve();
      return;
    }
    nextPromise = {
      wantsState: states.IDLE,
      resolve: resolve,
      reject: reject,
    }
  });
}

module.exports.takeOff = function() {
  console.log('takeOff');

  var uav = {
    'takeoff': true,
  };
  uavwatcher.push(SKYBOT_ID, uav);
  return new Promise(function(resolve, reject) {
    nextPromise = {
      wantsState: states.WAITING,
      afterState: states.TAKINGOFF,
      resolve: resolve,
      reject: reject,
    }
  });
}

module.exports.land = function() {
  console.log('land');

  var uav = {
    takeoff: false,
  };
  uavwatcher.push(SKYBOT_ID, uav);
  return new Promise(function(resolve, reject) {
    nextPromise = {
      wantsState: states.IDLE,
      afterState: states.LANDING,
      resolve: resolve,
      reject: reject,
    }
  });
}

module.exports.loiter = function(forward, left, up, duration) {
  console.log('loiter ', forward, left, up);

  var uav = {
    controlType: controlTypes.LOITER,
    forward: forward,
    left: left,
    up: up,
    latitude: 0,
    longitude: 0,
  };
  uavwatcher.push(SKYBOT_ID, uav);

  setTimeout(function() {
    var skybotStatusValue = uavwatcher.valueForUAV(SKYBOT_STATUS_ID);
    if (skybotStatusValue.state !== states.LOITERING)
      return;
    var uav = {
      controlType: controlTypes.IDLE,
      forward: 0,
      left: 0,
      up: 0,
      latitude: 0,
      longitude: 0,
      toto: 'caca',
    };
    uavwatcher.push(SKYBOT_ID, uav);
    flushUAVWatcher();
  }, duration);

  return new Promise(function(resolve, reject) {
    nextPromise = {
      wantsState: states.WAITING,
      afterState: states.LOITERING,
      resolve: resolve,
      reject: reject,
    }
  });
}

module.exports.go = function(latitude, longitude) {
  console.log('go ', latitude, longitude);

  var uav = {
    controlType: controlTypes.GOTO,
    latitude: latitude,
    longitude: longitude,
    forward: 0,
    left: 0,
    up: 0,
  };
  uavwatcher.push(SKYBOT_ID, uav);
  return new Promise(function(resolve, reject) {
    nextPromise = {
      wantsState: states.WAITING,
      afterState: states.GOINGTO,
      resolve: resolve,
      reject: reject,
    }
  });
}

/**
 *  Utils
 */

function waiting() {
  var skybotStatusValue = uavwatcher.valueForUAV(SKYBOT_STATUS_ID);
  return skybotStatusValue.state == states.WAITING;
}

function idle() {
  var skybotStatusValue = uavwatcher.valueForUAV(SKYBOT_STATUS_ID);
  return skybotStatusValue.status == states.IDLE && skybotStatusValue.state == states.IDLE;
}

/**
 *  Connection configuration and initialization
 */

// TODO there is a problem with having the client initialization in the module's abstraction,
// this approach prevents having multiple module's abstaction to run in the same user module.
// We chose to leave this for later, as a more global solution might arise.
var client = Client('ws://127.0.0.1:4224/uav', {debug: false});

module.exports.onReady = function(onReady, onError) {
  client.onReady(function() {
    uavwatcher = new UAVWatcher(client.definitionsStore);

    client.requestValuesForUavs([UAV_NAME, UAV_STATUS_NAME]).then(
      function(values) {
        // load initial values
        uavwatcher.push(SKYBOT_ID, {controlType: controlTypes.IDLE, forward: 0, left: 0, up: 0, latitude: 0, longitude: 0}).done();
        uavwatcher.push(values[1].objectId, values[1].data).done();

        client.updateHandlers.attach(UAV_NAME, onUpdate);
        client.updateHandlers.attach(UAV_STATUS_NAME, onUpdate);

        flushUAVWatcher();
        console.log('Started');
        onReady();
      },
      function(errors) {
        console.log(errors);
        onError(errors);
      }
    );

    client.connect();
  });
};

/**
 *  change listeners
 */

var nextPromise;/* = {
  wantsState: '',
  afterState: '',
  resolve: function(){},
  reject: function(){},
}*/

function onUpdate(uavo) {
  var container = uavwatcher.push(uavo.objectId, uavo.data);
  if (container.dirty) {
    container.done();
    // if this is the SkybotControlStatus uavObject, and we have a current promise, treat it.
    if (nextPromise && container.objectId == SKYBOT_STATUS_ID) {
      var tmp = nextPromise;
      if (tmp.wantsState == container.currentValue.value.state) { // we reached the desired state:)
        nextPromise = null;
        tmp.resolve();
      } else if (!_.isUndefined(tmp.afterState) && tmp.afterState !== container.currentValue.value.state && tmp.started) { // something is abnormal, we should have either wantsState or afterState as a state
        nextPromise = null;
        tmp.reject();
        console.log('reject ' + JSON.stringify(tmp) + ' ' + JSON.stringify(uavo.data));
      } else if (!_.isUndefined(tmp.afterState) && tmp.afterState == container.currentValue.value.state) {
        if (!tmp.started) {
          console.log('Started: ' + tmp.afterState);
        }
        tmp.started = true;
      } // TODO we need a timeout for nextPromises that don't have an afterState field, and when afterState is never reached
      flushUAVWatcher();
    }
  }
}

function flushUAVWatcher() {
  uavwatcher.forEachDirty(function(container) {
    client.connection.sendUpdateWithId(container.objectId, container.currentValue.value);
    container.done();
  });
}

/*
 * Send SkybotControl uav value periodically, every 500ms to prevent watchdog triggering on SkybotControl module side.
 */

var running = true;
function sendSkybotControl() {
  var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);

  client.connection.sendUpdateWithId(SKYBOT_ID, skybotValue);
  if (!running)
    return;
  setTimeout(sendSkybotControl, 500);
}

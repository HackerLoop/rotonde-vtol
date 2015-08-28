'use strict';

var Client = require('skybot-client');

var _ = require('lodash');

/**
 *  Connection configuration and initialization
 */
var client = Client('ws://127.0.0.1:4224/uav', {debug: false});

client.onReady(function() {
  client.connection.sendDefinition(SkybotDefinition);
  client.updateHandlers.attach('SkybotControl', onUpdate);
  client.requestHandlers.attach('SkybotControl', onRequest);
  client.requestValuesForUavs(['GCSReceiver', 'ManualControlSettings']).then(
    function(values) {
      initialMCS = values[1];
    },
    function(errors) {
      console.log(errors);
    }
  );
});

process.on('exit', function(code) {
  console.log("About to exit");
});

client.connect();

/**
 *  Mode setupers
 */

function setupGCSControl() {

}

/**
 *  Skybot module definition and default value
 */

var skybotStatuses = {
  OK: 'OK',
  WORKING: 'WORKING',
  ERROR: 'ERROR',
};

var SkybotDefinition = {
  name: 'SkybotControl',
  id: 42424242,
  description: 'Provides base uavobject for high-level modules and skybot-control',
  fields: [
    {
      name: 'takeoff',
      units: 'boolean',
      elements: 1,
    },
    {
      name: 'status',
      units: 'enum',
      options: [skybotStatuses.OK, skybotStatuses.WORKING, skybotStatuses.ERROR],
      elements: 1,
    },
    {
      name: 'forward',
      units: 'm/s',
      elements: 1,
    },
    {
      name: 'takeoff',
      units: 'm/s',
      elements: 1,
    },
    {
      name: 'up',
      units: 'm/s',
      elements: 1,
    },
  ]
};

var skybotValue = {
  takeoff: false,
  status: skybotStatuses.OK,
  forward: 0,
  left: 0,
  up: 0,
};

function updateSkybotValue(newValue) {
  _.extend(skybotValue, newValue);
  client.connection.sendUpdate('SkybotControl', skybotValue);
}

// holds the initial manualcontrolsettings, needed to revert it when leaving control
var initialMCS;

function capitalize(s) {
  return s[0].toUpperCase() + s.substr(1);
}

/**
 *  UAVO update change handlers
 *  return true to signal change in uavo
 */
function onForward(v) {
  console.log('onForward ' + v);
  return true;
}

function onLeft(v) {
  console.log('onLeft ' + v);
  return true;
}

function onUp(v) {
  console.log('onUp ' + v);
  return true;
}

function onTakeoff(v) {
  console.log('onTakeoff ' + v);
  return true;
}

function mockWork() {
  updateSkybotValue({status: skybotStatuses.WORKING});
  setTimeout(function() {
    updateSkybotValue({status: skybotStatuses.OK});
  }, 3000);
}

/**
 *  change listeners
 */
var lastUpdate = -1;
var rwKeys = ['forward', 'left', 'takeoff', 'up'];
function onUpdate(uavo) {
  if (skybotValue.status !== skybotStatuses.OK) {
    return;
  }
  uavo = uavo.data;

  // call handlers for writable keys (rwKeys) on change
  var updated = false;
  _.forEach(rwKeys, function(key) {
    if (_.isUndefined(uavo[key])) {
      return;
    }

    if (skybotValue[key] != uavo[key]) {
      var fnName = 'on' + capitalize(key);
      var fn = eval(fnName); // :(

      skybotValue[key] = uavo[key];
      updated |= fn(uavo[key]);
    }
  });
  // if anything change fake working
  if (updated) {
    mockWork();
  }
}

// respond to requests
function onRequest() {
  client.connection.sendUpdate('SkybotControl', skybotValue);
}

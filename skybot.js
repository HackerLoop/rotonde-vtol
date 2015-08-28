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
  client.requestValuesForUavs(['GCSReceiver', 'ManualControlSettings']).then(
    function(values) {
      console.log(values);
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
 *  Skybot module
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

// holds the initial manualcontrolsettings, needed to revert it when leaving control
var initialMCS;

function capitalize(s) {
  return s[0].toUpperCase() + s.substr(1);
}

/**
 *  UAVO update change handlers
 */
function onForward(v) {
  console.log('onForward ' + v);
}

function onLeft(v) {
  console.log('onLeft ' + v);
}

function onUp(v) {
  console.log('onUp ' + v);
}

function onTakeoff(v) {
  console.log('onTakeoff ' + v);
}

/**
 *  change listeners
 */
var lastUpdate = -1;
var rwKeys = ['forward', 'left', 'status', 'takeoff', 'up'];
function onUpdate(uavo) {
  if (skybotValue.status !== skybotStatuses.OK) {
    return;
  }
  uavo = uavo.data;

  _.forEach(rwKeys, function(key) {
    if (_.isUndefined(uavo[key])) {
      return;
    }

    if (skybotValue[key] != uavo[key]) {
      var fnName = 'on' + capitalize(key);
      var fn = eval(fnName);

      fn(uavo[key]);
      skybotValue[key] = uavo[key];
    }
  });
}

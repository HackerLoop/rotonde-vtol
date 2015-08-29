'use strict';

var MOCK_STATES = true;

var MODULE_NAME = 'SkybotControl';
var MAX_UPDATELESS_TIME = 1000;
var SKYBOT_ID = 42424242;

var UAVWatcher = require('./uavwatcher');
var StateMachine = require('./state_machine');
var Client = require('skybot-client');

var _ = require('lodash');

/**
 *  Skybot module definition and default value
 */

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
};
var controlTypes = {
  LOITER: 'LOITER',
  GOTO: 'GOTO',
  IDLE: 'IDLE',
};

var SkybotDefinition = {
  name: MODULE_NAME,
  id: SKYBOT_ID,
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
      options: _.keys(statuses),
      elements: 1,
    },
    {
      name: 'state',
      units: 'enum',
      options: _.keys(states),
      elements: 1,
    },
    {
      name: 'controlType',
      units: 'enum',
      options: _.keys(controlTypes),
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

var initialSkybotValue = {
  takeoff: false,
  status: statuses.IDLE,
  state: states.IDLE,
  controlType: controlTypes.IDLE,
  forward: 0,
  left: 0,
  up: 0,
};

var uavwatcher;

/**
 *  Connection configuration and initialization
 */
var client = Client('ws://127.0.0.1:4224/uav', {debug: false});

client.onReady(function() {
  client.connection.sendDefinition(SkybotDefinition);
  client.updateHandlers.attach(MODULE_NAME, onUpdate);
  client.requestHandlers.attach(MODULE_NAME, onRequest);

  uavwatcher = new UAVWatcher(client.definitionsStore);
  uavwatcher.addOrUpdateUAV(SKYBOT_ID, initialSkybotValue);

  client.requestValuesForUavs(['GCSReceiver', 'ManualControlSettings']).then(
    function(values) {
      // load initial values for the requested uavs
      _.forEach(values, function(value) {
        uavwatcher.addOrUpdateUAV(value.objectId, value.data);
      });

      initStates();
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
 *  State machine management
 */

var machine;

function initStates() {
  var createStates = (MOCK_STATES ? require('./mock_states') : require('./states'));
  var States = createStates(SKYBOT_ID, initialSkybotValue, uavwatcher, states, statuses, controlTypes);

  machine = StateMachine.newMachine();
  machine.addState(States.Idle);
  machine.addState(States.TakingOff);
  machine.addState(States.Landing);
  machine.addState(States.Loitering);
  machine.addState(States.Waiting);
  machine.addState(States.GoingTo);

  setInterval(work, 50);
}

function work() {
  machine.update();
  undirtyWatcherAndSend();
};

function undirtyWatcherAndSend() {
  uavwatcher.forEachDirty(function(container) {
    client.connection.sendUpdateWithId(container.objectId, container.currentValue.value);
    container.done();
  });
}

/**
 *  Watchdog
 */

var lastUpdate = -1; // watchdog, tracks last update received as a UNIX timestamp,
                     // triggers IDLE status when exceeds MAX_UPDATELESS_TIME seconds
setInterval(function() {
  if (lastUpdate === -1) {
    return;
  }
  var time = new Date().getTime();
  if (time - lastUpdate > MAX_UPDATELESS_TIME) {
    console.log('Watchdog fired !');
    uavwatcher.addOrUpdateUAV(SKYBOT_ID, {status: statuses.IDLE});
    work();
    lastUpdate = -1;
  }
}, 500);

/**
 *  change listeners
 */

function onUpdate(uavo) {
  lastUpdate = new Date().getTime();

  var doWork = false;
  var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);
  if (skybotValue.status === statuses.IDLE) {
    console.log('exit IDLE state');
    skybotValue = uavwatcher.addOrUpdateUAV(SKYBOT_ID, {status: statuses.CONNECTED});
    if (skybotValue.dirty) {
      skybotValue.done();
      client.connection.sendUpdateWithId(SKYBOT_ID, skybotValue.currentValue.value);
      doWork = true;
    }
  }

  var container = uavwatcher.addOrUpdateUAV(uavo.objectId, uavo.data);
  if (container.dirty) {
    container.done();
    doWork = true;
  }

  if (doWork) {
    work(); // trigger a state machine round trip
  }
}

// respond to requests
function onRequest(req) {
  console.log('onRequest');
  var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);
  client.connection.sendUpdateWithId(SKYBOT_ID, skybotValue.currentValue.value);
}


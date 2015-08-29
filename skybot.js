'use strict';

var MODULE_NAME = 'SkybotControl';
var MAX_UPDATELESS_TIME = 1000;

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
};

var SkybotDefinition = {
  name: MODULE_NAME,
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
var skybotValue = _.cloneDeep(initialSkybotValue);
var skybotValueDirty = false;
var rwKeys = ['forward', 'left', 'takeoff', 'up', 'controlType'];

function updateSkybotValue(uavo, allKeys, sendUpdate) {
  // call handlers for writable keys (rwKeys) on change

  var keys = allKeys ? _.keys(initialSkybotValue) : rwKeys;

  var updated = false;
  _.forEach(keys, function(key) {
    if (_.isUndefined(uavo[key])) {
      return;
    }

    if (skybotValue[key] != uavo[key]) {
      var fnName = 'on' + capitalize(key);
      var fn = eval(fnName); // :(

      skybotValue[key] = uavo[key];
      fn(uavo[key]);
      skybotValueDirty = true;
    }
  });
  return updated;
}

// holds the initial manualcontrolsettings, needed to revert it when leaving control
var initialMCS;

function capitalize(s) {
  return s[0].toUpperCase() + s.substr(1);
}

/**
 *  Connection configuration and initialization
 */
var client = Client('ws://127.0.0.1:4224/uav', {debug: false});

client.onReady(function() {
  client.connection.sendDefinition(SkybotDefinition);
  client.updateHandlers.attach(MODULE_NAME, onUpdate);
  client.requestHandlers.attach(MODULE_NAME, onRequest);
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
 *  State management
 */

var States = {};

States.Idle = (function() {
  return {
    start: function() {
      updateSkybotValue(_.extend(initialSkybotValue, {status: skybotValue.status}), true);
    }
  };
})();

States.TakingOff = (function() {
  var working = false;
  return {
    priority: 10,
    canTrigger: function() {
      return skybotValue.status === statuses.CONNECTED &&
             skybotValue.takeoff === true &&
             skybotValue.state === states.IDLE;
    },
    start: function() {
      updateSkybotValue({state: states.TAKINGOFF, forward: 0, left: 0, up: 0}, true);
      working = true;
      setTimeout(function() {
        working = false;
      }, 3000);
    },
    update: function() {
      return working;
    },
    end: function() {
    }
  };
})();

States.Landing = (function() {
  var working = false;
  return {
    priority: 10,
    canTrigger: function() {
      return (
              (skybotValue.status === statuses.CONNECTED && skybotValue.takeoff === false) ||
              skybotValue.status === statuses.IDLE
             ) &&
             skybotValue.state !== states.IDLE &&
             skybotValue.state !== states.LANDING;
    },
    start: function() {
      updateSkybotValue({state: states.LANDING, takeoff: false, forward: 0, left: 0, up: 0}, true);
      working = true;
      setTimeout(function() {
        working = false;
      }, 3000);
    },
    update: function() {
      return working;
    },
    end: function() {
    }
  };

})();

States.Loitering = (function() {
  var working = false;
  return {
    priority: 5,
    canTrigger: function() {
      return skybotValue.controlType === controlTypes.LOITER &&
             skybotValue.status === statuses.CONNECTED &&
             skybotValue.takeoff === true &&
             skybotValue.state === states.WAITING &&
             skybotValue.forward !== 0 && skybotValue.left !== 0 && skybotValue.up !== 0;
    },
    start: function() {
      updateSkybotValue({state: states.LOITERING}, true);
      working = true;
      setTimeout(function() {
        working = false;
      }, 1000);
    },
    update: function() {
      return working;
    },
    end: function() {
      updateSkybotValue({forward: 0, left: 0, up: 0});
    }
  };

})();

States.GoingTo = (function() {
  var working = false;
  return {
    priority: 5,
    canTrigger: function() {
      return skybotValue.controlType === controlTypes.GOTO &&
             skybotValue.status === statuses.CONNECTED &&
             skybotValue.takeoff === true &&
             skybotValue.state === states.WAITING;
    },
    start: function() {
      updateSkybotValue({state: states.GOINGTO}, true);
      working = true;
      setTimeout(function() {
        working = false;
      }, 10000);
    },
    update: function() {
      return working;
    },
    end: function() {
    }
  };
})();

States.Waiting = (function() {
  return {
    priority: 1,
    canTrigger: function() {
      return skybotValue.status === statuses.CONNECTED &&
             skybotValue.takeoff === true;
    },
    start: function() {
      updateSkybotValue({state: states.WAITING, forward: 0, left: 0, up: 0}, true);
    },
  };
})();

var machine = StateMachine.newMachine();
machine.addState(States.Idle);
machine.addState(States.TakingOff);
machine.addState(States.Landing);
machine.addState(States.Loitering);
machine.addState(States.Waiting);
machine.addState(States.GoingTo);

function work() {
  skybotValueDirty = false;
  machine.update();
  if (skybotValueDirty) {
    client.connection.sendUpdate(MODULE_NAME, skybotValue);
  }

};
setInterval(work, 50);

// should only be called by the current state
States.currentStateEnd = function() {
  if (States.nextState !== States.Cu) {
    States.currentState = States.nextState;
  } else {
    States.currentState = States.Idle;
  }
};

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

function onStatus(v) {
  console.log('onStatus ' + v);
  return false;
}

function onState(v) {
  console.log('onState ' + v);
  return false;
}

function onControlType(v) {
  console.log('onControlType');
  return false;
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
    updateSkybotValue({status: statuses.IDLE}, true, true);
    lastUpdate = -1;
  }
}, 500);

/**
 *  change listeners
 */
function onUpdate(uavo) {
  lastUpdate = new Date().getTime();

  if (skybotValue.status === statuses.IDLE) {
    console.log('exit IDLE state');
    updateSkybotValue({status: statuses.CONNECTED}, true, true);
  }

  updateSkybotValue(uavo.data);
}

// respond to requests
function onRequest() {
  console.log('onRequest');
  client.connection.sendUpdate(MODULE_NAME, skybotValue);
}

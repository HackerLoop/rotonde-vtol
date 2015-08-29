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

  client.requestValuesForUavs(['GCSReceiver', 'ManualControlSettings', 'FlightStatus']).then(
    function(values) {
      // load initial values for the requested uavs
      _.forEach(values, function(value) {
        uavwatcher.addOrUpdateUAV(value.objectId, value.data);
      });

      initStates();

      console.log('Started');

    },
    function(errors) {
      console.log(errors);
    }
  );

});

process.on('exit', function(code) {
  console.log('About to exit');
});

client.connect();

/**
 *  State machine management
 */

var machine;

/**
 * Chaining conditions
 */

function shouldTakeOff() {
  var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);
  return skybotValue.status === statuses.CONNECTED &&
    skybotValue.takeoff === true &&
    skybotValue.state === states.IDLE;
}

function shouldLand() {
  var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);
  return (
    (skybotValue.status === statuses.CONNECTED && skybotValue.takeoff === false) ||
      skybotValue.status === statuses.IDLE
  ) &&
    skybotValue.state !== states.IDLE &&
    skybotValue.state !== states.LANDING;
}

function shouldLoiter() {
  var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);
  return skybotValue.controlType === controlTypes.LOITER &&
    skybotValue.status === statuses.CONNECTED &&
    skybotValue.takeoff === true &&
    skybotValue.state === states.WAITING &&
    (skybotValue.forward !== 0 || skybotValue.left !== 0 || skybotValue.up !== 0);
}

function shouldGoto() {
  var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);
  return skybotValue.controlType === controlTypes.GOTO &&
    skybotValue.status === statuses.CONNECTED &&
    skybotValue.takeoff === true &&
    skybotValue.state === states.WAITING;
}

function shouldWait() {
  var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);
  return skybotValue.status === statuses.CONNECTED &&
    skybotValue.takeoff === true;
}

/**
 *  States definition
 */

var MockStates = {};

MockStates.Idle = (function() {
  return {
    start: function() {
      var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);
      uavwatcher.addOrUpdateUAV(SKYBOT_ID, _.extend(initialSkybotValue, {status: skybotValue.status}));
    }
  };
})();

MockStates.TakingOff = (function() {
  var working = false;
  return {
    priority: 10,
    canTrigger: function() {
      return shouldTakeOff();
    },
    start: function() {
      uavwatcher.addOrUpdateUAV(SKYBOT_ID, {state: states.TAKINGOFF, forward: 0, left: 0, up: 0});
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

MockStates.Landing = (function() {
  var working = false;
  return {
    priority: 10,
    canTrigger: function() {
      return shouldLand();
    },
    start: function() {
      uavwatcher.addOrUpdateUAV(SKYBOT_ID, {state: states.LANDING, takeoff: false, forward: 0, left: 0, up: 0}, true);
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

MockStates.Loitering = (function() {
  var working = false;
  return {
    priority: 5,
    canTrigger: function() {
      return shouldLoiter();
    },
    start: function() {
      uavwatcher.addOrUpdateUAV(SKYBOT_ID, {state: states.LOITERING}, true);
      working = true;
      setTimeout(function() {
        working = false;
      }, 1000);
    },
    update: function() {
      return working;
    },
    end: function() {
      uavwatcher.addOrUpdateUAV(SKYBOT_ID, {forward: 0, left: 0, up: 0});
    }
  };

})();

MockStates.GoingTo = (function() {
  var working = false;
  return {
    priority: 5,
    canTrigger: function() {
      return shouldGoto();
    },
    start: function() {
      uavwatcher.addOrUpdateUAV(SKYBOT_ID, {state: states.GOINGTO}, true);
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

MockStates.Waiting = (function() {
  return {
    priority: 1,
    canTrigger: function() {
      return shouldWait();
    },
    start: function() {
      uavwatcher.addOrUpdateUAV(SKYBOT_ID, {state: states.WAITING, forward: 0, left: 0, up: 0}, true);
    },
  };
})();

/**
 *  real states
 */

var States = {};

States.Idle = (function() {
  return {
    start: function() {
      var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);
      uavwatcher.addOrUpdateUAV(SKYBOT_ID, _.extend(initialSkybotValue, {status: skybotValue.status}));
    }
  };
})();

States.TakingOff = (function() {
  var steps = {
    SETUP_GCS: 'SETUP_GCS',
    ZERO_THROTTLE: 'ZERO_THROTTLE',
    STABILIZED_MOD: 'STABILIZED_MOD',
    TEST_ACTUATORS: 'TEST_ACTUATORS',
  };
  var step = steps.SETUP_GCS;

  return {
    priority: 10,
    canTrigger: function() {
      return shouldTakeOff();
    },
    start: function() {
      step = steps.SETUP_GCS;
      uavwatcher.addOrUpdateUAV(SKYBOT_ID, {state: states.TAKINGOFF, forward: 0, left: 0, up: 0});
    },
    update: function() {
      switch(step) {
      case steps.SETUP_GCS:
        gcsControl();
        step = steps.ZERO_THROTTLE;
        break;
      case steps.ZERO_THROTTLE:
        gcsReceiverChannel(0, -1);
        step = steps.STABILIZED_MOD;
        break;
      case steps.STABILIZED_MOD:
        flightMode('Stabilized1');
        step = steps.TEST_ACTUATORS;
        break;
      case steps.TEST_ACTUATORS:
        gcsReceiverChannel(0, -0.9);
        break;
      }
      return true;
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
      return shouldLand();
    },
    start: function() {
      uavwatcher.addOrUpdateUAV(SKYBOT_ID, {state: states.LANDING, takeoff: false, forward: 0, left: 0, up: 0}, true);
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
      return shouldLoiter();
    },
    start: function() {
      uavwatcher.addOrUpdateUAV(SKYBOT_ID, {state: states.LOITERING}, true);
      working = true;
      setTimeout(function() {
        working = false;
      }, 1000);
    },
    update: function() {
      return working;
    },
    end: function() {
      uavwatcher.addOrUpdateUAV(SKYBOT_ID, {forward: 0, left: 0, up: 0});
    }
  };

})();

States.GoingTo = (function() {
  var working = false;
  return {
    priority: 5,
    canTrigger: function() {
      return shouldGoto();
    },
    start: function() {
      uavwatcher.addOrUpdateUAV(SKYBOT_ID, {state: states.GOINGTO}, true);
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
      return shouldWait();
    },
    start: function() {
      uavwatcher.addOrUpdateUAV(SKYBOT_ID, {state: states.WAITING, forward: 0, left: 0, up: 0}, true);
    },
  };
})();

function initStates() {
  var s = (MOCK_STATES ? MockStates : States);

  machine = StateMachine.newMachine();
  machine.addState(s.Idle);
  machine.addState(s.TakingOff);
  machine.addState(s.Landing);
  machine.addState(s.Loitering);
  machine.addState(s.Waiting);
  machine.addState(s.GoingTo);

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
 *  Taulab uavtalk helpers
 */

function setupInitialSettings() {

}

function gcsControl() {
  uavwatcher.addOrUpdateUAV('ManualControlSettings', {
    Arming: 'Switch',
    ArmedTimeout:0,
    ArmTimeoutAutonomous:'DISABLED',
    FlightModeNumber:1,
    ChannelNeutral: {
      Accessory0:1500,
      Accessory1:1500,
      Accessory2:1500,
      Arming:1500,
      Collective:1500,
      FlightMode:1500,
      Pitch:1500,
      Roll:1500,
      Throttle:1500,
      Yaw:1500
    },
    ChannelNumber: {
      Accessory0:0,
      Accessory1:0,
      Accessory2:0,
      Arming:5,
      Collective:0,
      FlightMode:0,
      Pitch:3,
      Roll:2,
      Throttle:1,
      Yaw:4
    },
    ChannelMin: {
      Accessory0:1000,
      Accessory1:1000,
      Accessory2:1000,
      Arming:1000,
      Collective:1000,
      FlightMode:1000,
      Pitch:1000,
      Roll:1000,
      Throttle:1000,
      Yaw:1000
    },
    ChannelMax: {
      Accessory0:2000,
      Accessory1:2000,
      Accessory2:2000,
      Arming:2000,
      Collective:2000,
      FlightMode:2000,
      Pitch:2000,
      Roll:2000,
      Throttle:2000,
      Yaw:2000
    },
    ChannelGroups: {
      Accessory0:'None',
      Accessory1:'None',
      Accessory2:'None',
      Arming:'GCS',
      Collective:'None',
      FlightMode:'None',
      Pitch:'GCS',
      Roll:'GCS',
      Throttle:'GCS',
      Yaw:'GCS' 
    }
  });

  uavwatcher.addOrUpdateUAV('GCSReceiver', {
    Channel: [-1, 0, 0, 0, 0, 0, 0, 0]
  });
}

function gcsReceiverChannel(channel, value) {
  var gcsReceiver = _.cloneDeep(uavwatcher.valueForUAV('GCSReceiver'));
  gcsReceiver.Channel[channel] = value;
  uavwatcher.addOrUpdateUAV('GCSReceiver', gcsReceiver);
}

/**
 * 'AltitudeHold'
 * 'Stabilized1',
 * 'ReturnToHome'
 * 'PositionHold'
 */
function flightMode(flightMode) {
  uavwatcher.addOrUpdateUAV({
    FlightMode: flightMode,
  });
}

function loiterCommand(loiterCommand) {

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
    skybotValue.done();
    client.connection.sendUpdateWithId(SKYBOT_ID, skybotValue.currentValue.value);
    doWork = true;
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


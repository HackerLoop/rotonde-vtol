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
  ERROR: 'ERROR',
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
var client = Client('ws://127.0.0.1:4224/uav', {debug: true});

client.onReady(function() {
  client.connection.sendDefinition(SkybotDefinition);
  client.updateHandlers.attach(MODULE_NAME, onUpdate);
  client.requestHandlers.attach(MODULE_NAME, onRequest);

  uavwatcher = new UAVWatcher(client.definitionsStore);
  uavwatcher.addOrUpdateUAV(SKYBOT_ID, initialSkybotValue);

  client.requestValuesForUavs(['GCSReceiver', 'ManualControlSettings', 'FlightStatus', 'SystemAlarms', 'GPSPosition']).then(
    function(values) {
      // load initial values for the requested uavs
      _.forEach(values, function(value) {
        uavwatcher.addOrUpdateUAV(value.objectId, value.data);
      });

      initStates();

      client.updateHandlers.attach('SystemAlarms', onUpdate);
      client.updateHandlers.attach('GPSPosition', onUpdate);

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

MockStates.Error = (function() {
  return {
    priority: 20,
    canTrigger: function() {
      var error = false;
      var systemalarms = uavwatcher.valueForUAV('SystemAlarms');
      _.forEach(_.keys(systemalarms.Alarm), function(key) {
        var status = systemalarms.Alarm[key];
        if (status == 'Error' || status == 'Critical') {
          console.log(key + ' : ' + status);
          error = true;
        }
      });
      return error;
    },
    start: function() {
      uavwatcher.addOrUpdateUAV(SKYBOT_ID, {state: states.ERROR, status: statuses.ERROR, forward: 0, left: 0, up: 0}, true);
    },
  };
})()

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
  machine.addState(s.Error);

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

var GCSReceiverChannelValues = {
  MIN: 1000,
  MED: 1500,
  MAX: 2000
};

function gcsControl() {
  uavwatcher.addOrUpdateUAV('ManualControlSettings', {
    Arming: 'Switch',
    ArmedTimeout:0,
    ArmTimeoutAutonomous:'DISABLED',
    FlightModeNumber:1,
    ChannelNeutral: {
      Accessory0:GCSReceiverChannelValues.MED,
      Accessory1:GCSReceiverChannelValues.MED,
      Accessory2:GCSReceiverChannelValues.MED,
      Arming:GCSReceiverChannelValues.MED,
      Collective:GCSReceiverChannelValues.MED,
      FlightMode:GCSReceiverChannelValues.MED,
      Pitch:GCSReceiverChannelValues.MED,
      Roll:GCSReceiverChannelValues.MED,
      Throttle:GCSReceiverChannelValues.MED,
      Yaw:GCSReceiverChannelValues.MED
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
      Accessory0:GCSReceiverChannelValues.MIN,
      Accessory1:GCSReceiverChannelValues.MIN,
      Accessory2:GCSReceiverChannelValues.MIN,
      Arming:GCSReceiverChannelValues.MIN,
      Collective:GCSReceiverChannelValues.MIN,
      FlightMode:GCSReceiverChannelValues.MIN,
      Pitch:GCSReceiverChannelValues.MIN,
      Roll:GCSReceiverChannelValues.MIN,
      Throttle:GCSReceiverChannelValues.MIN,
      Yaw:GCSReceiverChannelValues.MIN
    },
    ChannelMax: {
      Accessory0:GCSReceiverChannelValues.MAX,
      Accessory1:GCSReceiverChannelValues.MAX,
      Accessory2:GCSReceiverChannelValues.MAX,
      Arming:GCSReceiverChannelValues.MAX,
      Collective:GCSReceiverChannelValues.MAX,
      FlightMode:GCSReceiverChannelValues.MAX,
      Pitch:GCSReceiverChannelValues.MAX,
      Roll:GCSReceiverChannelValues.MAX,
      Throttle:GCSReceiverChannelValues.MAX,
      Yaw:GCSReceiverChannelValues.MAX
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
    Channel: [GCSReceiverChannelValues.MIN, GCSReceiverChannelValues.MED, GCSReceiverChannelValues.MED, GCSReceiverChannelValues.MED, GCSReceiverChannelValues.MED, GCSReceiverChannelValues.MED, GCSReceiverChannelValues.MED, GCSReceiverChannelValues.MED]
  });
}

// value is between -1 and 1, the function then interpolates
// to set the right value based on channel min/med/max
function gcsReceiverChannel(channel, value) {
  var gcsReceiver = _.cloneDeep(uavwatcher.valueForUAV('GCSReceiver'));
  var convert = 0;

  if (value < 0) {
    convert = GCSReceiverChannelValues.MED + (GCSReceiverChannelValues.MIN - GCSReceiverChannelValues.MED) * value;
  } else if (value > 0) {
    convert = GCSReceiverChannelValues.MED + (GCSReceiverChannelValues.MAX - GCSReceiverChannelValues.MED) * value;
  }

  gcsReceiver.Channel[channel] = convert;
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
  var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);
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

  var doWork = false;
  if (uavo.objectId === SKYBOT_ID) {
    var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);
    if (skybotValue.status === statuses.ERROR)
      return;

    lastUpdate = new Date().getTime();

    if (skybotValue.status === statuses.IDLE) {
      console.log('exit IDLE state');
      skybotValue = uavwatcher.addOrUpdateUAV(SKYBOT_ID, {status: statuses.CONNECTED});
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
  client.connection.sendUpdateWithId(SKYBOT_ID, skybotValue);
}


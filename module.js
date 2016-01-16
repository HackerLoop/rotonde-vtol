#!/usr/bin/env node --harmony

'use strict';

const MOCK_STATES = true;

const _ = require('lodash');

const UAVWatcher = require('./uavwatcher');
const StateMachine = require('./state_machine');
const newClient = require('rotonde-client/src/Client');

const client = newClient('ws://127.0.0.1:4224/uav');

const uavwatcher = new UAVWatcher();
const localwatcher = new UAVWatcher();

/**
 * TODO refactor with behavioural tree algorithm
 */

/**
 *  Skybot module definition and default value
 */

const MAX_PINGLESS_TIME = 1000;

client.addLocalDefinition('action', 'VTOL_PING', []);
client.addLocalDefinition('action', 'VTOL_TAKEOFF', []);
client.addLocalDefinition('action', 'VTOL_LAND', []);
client.addLocalDefinition('action', 'VTOL_GET_STATUS', []);

client.addLocalDefinition('action', 'VTOL_LOITER', [
  {
    name: 'forward',
    type: 'number',
    units: 'm/s',
  },
  {
    name: 'right',
    type: 'number',
    units: 'm/s',
  },
  {
    name: 'up',
    type: 'number',
    units: 'm/s',
  },
]);

client.addLocalDefinition('action', 'VTOL_GOTO', [
  {
    name: 'latitude',
    type: 'number',
    units: 'deg',
  },
  {
    name: 'longitude',
    type: 'number',
    units: 'deg',
  },
]);

client.addLocalDefinition('event', 'VTOL_STATUS', [
  {
    name: 'status',
    type: 'enum()',
    units: '',
  },
  {
    name: 'state',
    type: 'enum()',
    units: '',
  },
]);

localwatcher.push('VTOL_STATUS', {
  status: 'IDLE',
  state: 'IDLE',
});

localwatcher.push('VTOL_STATE', {
  takeoff: false,
  controlType: 'IDLE',
  forward: 0,
  left: 0,
  up: 0,
  latitude: 0,
  longitude: 0,
});

client.actionHandlers.attach('*', (a) => {
  const vtolStatus = localwatcher.get('VTOL_STATUS');
  if (vtolStatus.status === 'ERROR')
    return;

  lastUpdate = new Date().getTime();

  if (vtolStatus.status === 'IDLE') {
    console.log('exit IDLE state');
    localwatcher.push('VTOL_STATUS', {status: 'CONNECTED'});
  }
});

client.actionHandlers.attach('VTOL_GET_STATUS', (a) => {
  const vtolStatus = localwatcher.get('VTOL_STATUS');
  client.sendEvent('VTOL_STATUS', vtolStatus);
});

client.actionHandlers.attach('VTOL_TAKEOFF', (a) => {
  const vtolStatus = localwatcher.get('VTOL_STATUS');
  if (vtolStatus.status === 'ERROR')
    return;

  localwatcher.push('VTOL_STATE', {takeoff: true});
});

client.actionHandlers.attach('VTOL_LAND', (a) => {
  const vtolStatus = localwatcher.get('VTOL_STATUS');
  if (vtolStatus.status === 'ERROR')
    return;

  localwatcher.push('VTOL_STATE', {takeoff: false});
});

client.actionHandlers.attach('VTOL_LOITER', (a) => {
  const vtolStatus = localwatcher.get('VTOL_STATUS');
  if (vtolStatus.status === 'ERROR')
    return;

  localwatcher.push('VTOL_STATE', _.merge({controlType: 'LOITER'}, a.data));
});

client.actionHandlers.attach('VTOL_GOTO', (a) => {
  const vtolStatus = localwatcher.get('VTOL_STATUS');
  if (vtolStatus.status === 'ERROR')
    return;

  localwatcher.push('VTOL_STATE', _.merge({controlType: 'GOTO'}, a.data));
});

/**
 *  Connection configuration and initialization
 */

client.onReady(() => {

  // mute updates
  const skippedModes = ['FLIGHTSTATUS', 'SYSTEMALARMS'];
  client.definitionHandlers.attach('*', (definition) => {
    const identifier = definition.identifier;
    if (identifier.startsWith('SET_') && identifier.endsWith('META')) {
      const getterIdentifier = identifier.replace('SET_', 'GET_');
      const updateIdentifier = identifier.replace('SET_', '');
      if (_.includes(skippedModes, updateIdentifier.replace('META', ''))) {
        return;
      }
      client.sendAction(getterIdentifier, {});
      client.eventHandlers.attachOnce(updateIdentifier, (e) => {
        client.sendAction(identifier, {
          "modes": e.data.modes & 207, "periodFlight": 0, "periodGCS": 0, "periodLog": 0,
        });
      });
    }
  });

  client.bootstrap({'GET_GCSRECEIVER': {}, 'GET_MANUALCONTROLSETTINGS': {}, 'GET_FLIGHTSTATUS': {}, 'GET_SYSTEMALARMS': {}}, ['GCSRECEIVER', 'MANUALCONTROLSETTINGS', 'FLIGHTSTATUS', 'SYSTEMALARMS'], ['GCSRECEIVER', 'SET_GCSRECEIVER', 'MANUALCONTROLSETTINGS', 'SET_MANUALCONTROLSETTINGS', 'FLIGHTSTATUS', 'SYSTEMALARMS']).then(
    (values) => {
      // load initial values for the requested uavs
      try {
      _.forEach(values, (value) => {
        uavwatcher.push(value.identifier, value.data).done();
        client.eventHandlers.attach(value.identifier, (e) => {
          uavwatcher.push(e.identifier, e.data).done();
        });
      });
      } catch (e) {
        console.log(e);
      }

      initStates();
    },
    function(errors) {
      console.error(errors);
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
  const vtolState = localwatcher.get('VTOL_STATE');
  const vtolStatus = localwatcher.get('VTOL_STATUS');
  return vtolStatus.status === 'CONNECTED' &&
    vtolState.takeoff === true &&
    vtolStatus.state === 'IDLE';
}

function shouldLand() {
  const vtolState = localwatcher.get('VTOL_STATE');
  const vtolStatus = localwatcher.get('VTOL_STATUS');
  return (
    (vtolStatus.status === 'CONNECTED' && vtolState.takeoff === false) ||
      vtolStatus.status === 'IDLE') &&
    vtolStatus.state !== 'IDLE' &&
    vtolStatus.state !== 'LANDING';
}

function shouldLoiter() {
  const vtolState = localwatcher.get('VTOL_STATE');
  const vtolStatus = localwatcher.get('VTOL_STATUS');
  return vtolState.controlType === 'LOITER' &&
    vtolStatus.status === 'CONNECTED' &&
    vtolState.takeoff === true &&
    (vtolState.forward !== 0 || vtolState.left !== 0 || vtolState.up !== 0);
}

function shouldGoto() {
  const vtolState = localwatcher.get('VTOL_STATE');
  const vtolStatus = localwatcher.get('VTOL_STATUS');
  return vtolState.controlType === 'GOTO' &&
    vtolStatus.status === 'CONNECTED' &&
    vtolState.takeoff === true;
}

function shouldWait() {
  const vtolState = localwatcher.get('VTOL_STATE');
  const vtolStatus = localwatcher.get('VTOL_STATUS');
  return vtolStatus.status === 'CONNECTED' &&
    vtolState.takeoff === true;
}

/**
 *  States definition
 */

var MockStates = {};

MockStates.Idle = (function() {
  return {
    start: function() {
      localwatcher.push('VTOL_STATUS', {state: 'IDLE'});
      console.log('Started state ' + 'IDLE');
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
      localwatcher.push('VTOL_STATUS', {state: 'TAKINGOFF'});
      working = true;
      setTimeout(function() {
        working = false;
      }, 3000);
      console.log('Started state ' + 'TAKINGOFF');
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
      localwatcher.push('VTOL_STATUS', {state: 'LANDING'});
      working = true;
      setTimeout(function() {
        working = false;
      }, 3000);
      console.log('Started state ' + 'LANDING');
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
      localwatcher.push('VTOL_STATUS', {state: 'LOITERING'});
      working = true;
      console.log('Started state ' + 'LOITERING');
    },
    update: function() {
      return shouldLoiter();
    },
    end: function() {
    }
  };

})();

MockStates.GoingTo = (function() {
  var working = false;
  var currentPosition = {latitude: 0, longitude: 0};
  return {
    priority: 5,
    canTrigger: function() {
      const vtolState = localwatcher.get('VTOL_STATE');
      return shouldGoto() &&
             (vtolState.latitude != currentPosition.latitude ||
             vtolState.longitude != currentPosition.longitude);
    },
    start: function() {
      localwatcher.push('VTOL_STATUS', {state: 'GOINGTO'});
      working = true;
      setTimeout(function() {
        const vtolState = localwatcher.get('VTOL_STATE');
        currentPosition = {latitude: vtolState.latitude, longitude: vtolState.longitude};
        working = false;
      }, 10000);
      console.log('Started state ' + 'GOINGTO');
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
      localwatcher.push('VTOL_STATUS', {state: 'WAITING'});
      console.log('Started state ' + 'WAITING');
    },
  };
})();

MockStates.Error = (function() {
  return {
    priority: 20,
    canTrigger: function() {
      var error = false;
      const systemalarms = uavwatcher.get('SYSTEMALARMS');
      _.forEach(_.keys(systemalarms.Alarm), function(key) {
        const status = systemalarms.Alarm[key];
        if (status == 'Error' || status == 'Critical') {
          console.error(key + ' : ' + status);
          error = true;
        }
      });
      return error;
    },
    start: function() {
      localwatcher.push('VTOL_STATUS', {state: 'ERROR', status: 'ERROR'});
      console.log('Started state ' + 'ERROR');
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
      localwatcher.push('VTOL_STATUS', {state: 'IDLE'});
      console.log('Started state ' + 'IDLE');
    }
  };
})();

States.TakingOff = (function() {
  const steps = {
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
      localwatcher.push('VTOL_STATUS', {state: 'TAKINGOFF'});
      console.log('Started state ' + 'TAKINGOFF');
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
      localwatcher.push('VTOL_STATUS', {state: 'LANDING'});
      working = true;
      setTimeout(function() {
        working = false;
      }, 3000);
      console.log('Started state ' + 'LANDING');
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
      localwatcher.push('VTOL_STATUS', {state: 'LOITERING'});
      working = true;
      setTimeout(function() {
        working = false;
      }, 1000);
      console.log('Started state ' + 'LOITERING');
    },
    update: function() {
      return working;
    },
    end: function() {
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
      localwatcher.push('VTOL_STATUS', {state: 'GOINGTO'});
      working = true;
      setTimeout(function() {
        working = false;
      }, 10000);
      console.log('Started state ' + 'GOINGTO');
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
      localwatcher.push('VTOL_STATUS', {state: 'WAITING'});
      console.log('Started state ' + 'WAITING');
    },
  };
})();

function initStates() {
  const s = (MOCK_STATES ? MockStates : States);

  machine = StateMachine.newMachine();
  machine.addState(s.Idle);
  machine.addState(s.TakingOff);
  machine.addState(s.Landing);
  machine.addState(s.Loitering);
  machine.addState(s.Waiting);
  machine.addState(s.GoingTo);
  //machine.addState(s.Error);

  setInterval(work, 50);
}

function work() {
  machine.update();
  undirtyWatcherAndSend();
};

function undirtyWatcherAndSend() {
  uavwatcher.forEachDirty(function(container) {
    client.sendEvent('SET_' + container.identifier, container.currentValue.value);
    container.done();
  });
  localwatcher.forEachDirty(function(container) {
    client.sendEvent(container.identifier, container.currentValue.value);
    container.done();
  });
}

/**
 *  Taulab uavtalk helpers
 */

const GCSReceiverChannelValues = {
  MIN: 1000,
  MED: 1500,
  MAX: 2000
};

function gcsControl() {
  uavwatcher.push('MANUALCONTROLSETTINGS', {
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

  uavwatcher.push('GCSRECEIVER', {
    Channel: [GCSReceiverChannelValues.MIN,
              GCSReceiverChannelValues.MED,
              GCSReceiverChannelValues.MED,
              GCSReceiverChannelValues.MED,
              GCSReceiverChannelValues.MED,
              GCSReceiverChannelValues.MED,
              GCSReceiverChannelValues.MED,
              GCSReceiverChannelValues.MED]
  });
}

// value is between -1 and 1, the function then interpolates
// to set the right value based on channel min/med/max
function gcsReceiverChannel(channel, value) {
  const gcsReceiver = _.cloneDeep(uavwatcher.get('GCSRECEIVER'));
  var convert = 0;

  if (value < 0) {
    convert = GCSReceiverChannelValues.MED + (GCSReceiverChannelValues.MIN - GCSReceiverChannelValues.MED) * value;
  } else if (value > 0) {
    convert = GCSReceiverChannelValues.MED + (GCSReceiverChannelValues.MAX - GCSReceiverChannelValues.MED) * value;
  }

  gcsReceiver.Channel[channel] = convert;
  uavwatcher.push('GCSRECEIVER', gcsReceiver);
}

/**
 * 'AltitudeHold'
 * 'Stabilized1',
 * 'ReturnToHome'
 * 'PositionHold'
 */
function flightMode(flightMode) {
  uavwatcher.push({
    FlightMode: flightMode,
  });
}

function loiterCommand(loiterCommand) {

}

/**
 *  Watchdog
 */

var lastUpdate = -1; // watchdog, tracks last update received as a UNIX timestamp,
                     // triggers IDLE status when exceeds MAX_PINGLESS_TIME seconds
setInterval(function() {
  if (lastUpdate === -1) {
    return;
  }
  var time = new Date().getTime();
  if (time - lastUpdate > MAX_PINGLESS_TIME) {
    console.log('Watchdog fired !');
    localwatcher.push('VTOL_STATUS', {status: 'IDLE'})
    lastUpdate = -1;
  }
}, 500);

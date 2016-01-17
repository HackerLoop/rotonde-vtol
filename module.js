#!/usr/bin/env node --harmony

'use strict';

const MOCK_STATES = true;

const _ = require('lodash');

const UAVWatcher = require('./uavwatcher');
const StateMachine = require('./state_machine');
const newClient = require('rotonde-client/src/Client');

const client = newClient('ws://127.0.0.1:4224/');

const uavwatcher = new UAVWatcher();
const localwatcher = new UAVWatcher();

/**
 * TODO refactor with behavioural tree algorithm
 */

/**
 *  Skybot module definition and default value
 */

const MAX_PINGLESS_TIME = 1000;

function addLocalDefinitions() {
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
    {
      name: 'duration',
      type: 'number',
      units: 'ms',
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

  client.actionHandlers.attach('*', (a) => {
    const vtolStatus = localwatcher.get('VTOL_STATUS');

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
    localwatcher.push('VTOL_STATE', {takeoff: true});
  });

  client.actionHandlers.attach('VTOL_LAND', (a) => {
    localwatcher.push('VTOL_STATE', {takeoff: false});
  });

  client.actionHandlers.attach('VTOL_LOITER', (a) => {
    localwatcher.push('VTOL_STATE', _.merge({controlType: 'LOITER'}, a.data));
    setTimeout(() => {
      const vtolStatus = localwatcher.get('VTOL_STATUS');
      if (vtolStatus.state !== 'LOITERING') {
        return;
      }
      localwatcher.push('VTOL_STATE', {controlType: 'IDLE', duration: 0, forward: 0, left: 0, up: 0});
    }, a.data.duration);
  });

  client.actionHandlers.attach('VTOL_GOTO', (a) => {
    localwatcher.push('VTOL_STATE', _.merge({controlType: 'GOTO'}, a.data));
  });

}

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

/**
 *  Connection configuration and initialization
 */

client.onReady(() => {

  // mute updates
  const WATCHED_UAVO = ['FLIGHTSTATUS', 'SYSTEMALARMS', 'BAROALTITUDE', 'GCSRECEIVER', 'MANUALCONTROLSETTINGS'];

  client.definitionHandlers.attach('*', (definition) => {
    const identifier = definition.identifier;

    if (identifier.startsWith('SET_') && identifier.endsWith('META')) {
      const getterIdentifier = identifier.replace('SET_', 'GET_');
      const updateIdentifier = identifier.replace('SET_', '');
      client.bootstrap(_.set({}, getterIdentifier, {}), [updateIdentifier], []).then((values) => {
        let e = values[0];
        let modes = e.data.modes & 207;
        if (_.includes(WATCHED_UAVO, updateIdentifier.replace('META', ''))) {
          modes = e.data.modes & 239;
        }

        client.sendAction(identifier, {
          "modes": modes, "periodFlight": 0, "periodGCS": 0, "periodLog": 0,
        });
      });
    }
  });

  client.unDefinitionHandlers.attach('*', (u) => {
    const identifier = u.identifier.replace(/(GET_|SET_|META)/g, '')
    console.log(identifier);
    if (_.includes(WATCHED_UAVO, identifier)) {
      console.log('Lost one of the required definitions, exiting.');
      process.exit();
    }
  });

  client.bootstrap(_.reduce(WATCHED_UAVO, (result, identifier) => _.set(result, 'GET_' + identifier, {}), {}),
                   WATCHED_UAVO,
                   _.reduce(WATCHED_UAVO, (result, identifier) => result.push(identifier, 'GET_' + identifier, 'SET_' + identifier) && result, [])
  ).then((values) => {
      // load initial values for the requested uavs
      console.log('subscribing to WATCHED_UAVO');
      _.forEach(values, (value) => {
        uavwatcher.push(value.identifier, value.data).done();
        client.eventHandlers.attach(value.identifier, (e) => {
          uavwatcher.push(e.identifier, e.data).done();
        });
      });

      addLocalDefinitions();
      initStates();
    },
    (errors) => {
      console.error(errors);
    }
  );

});

process.on('exit', (code) => {
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

MockStates.Idle = (() => {
  return {
    start: () => {
      localwatcher.push('VTOL_STATUS', {state: 'IDLE'});
      console.log('Started state ' + 'IDLE');
    }
  };
})();

MockStates.TakingOff = (() => {
  var working = false;
  return {
    priority: 10,
    canTrigger: () => {
      return shouldTakeOff();
    },
    start: () => {
      localwatcher.push('VTOL_STATUS', {state: 'TAKINGOFF'});
      working = true;
      setTimeout(() => {
        working = false;
      }, 3000);
      console.log('Started state ' + 'TAKINGOFF');
    },
    update: () => {
      return working;
    },
    end: () => {
    }
  };
})();

MockStates.Landing = (() => {
  var working = false;
  return {
    priority: 10,
    canTrigger: () => {
      return shouldLand();
    },
    start: () => {
      localwatcher.push('VTOL_STATUS', {state: 'LANDING'});
      working = true;
      setTimeout(() => {
        working = false;
      }, 3000);
      console.log('Started state ' + 'LANDING');
    },
    update: () => {
      return working;
    },
    end: () => {
    }
  };

})();

MockStates.Loitering = (() => {
  var working = false;
  return {
    priority: 5,
    canTrigger: () => {
      return shouldLoiter();
    },
    start: () => {
      localwatcher.push('VTOL_STATUS', {state: 'LOITERING'});
      working = true;
      console.log('Started state ' + 'LOITERING');
    },
    update: () => {
      return shouldLoiter();
    },
    end: () => {
    }
  };

})();

MockStates.GoingTo = (() => {
  var working = false;
  var currentPosition = {latitude: 0, longitude: 0};
  return {
    priority: 5,
    canTrigger: () => {
      const vtolState = localwatcher.get('VTOL_STATE');
      return shouldGoto() &&
             (vtolState.latitude != currentPosition.latitude ||
             vtolState.longitude != currentPosition.longitude);
    },
    start: () => {
      localwatcher.push('VTOL_STATUS', {state: 'GOINGTO'});
      working = true;
      setTimeout(() => {
        const vtolState = localwatcher.get('VTOL_STATE');
        currentPosition = {latitude: vtolState.latitude, longitude: vtolState.longitude};
        working = false;
      }, 10000);
      console.log('Started state ' + 'GOINGTO');
    },
    update: () => {
      return working;
    },
    end: () => {
    }
  };
})();

MockStates.Waiting = (() => {
  return {
    priority: 1,
    canTrigger: () => {
      return shouldWait();
    },
    start: () => {
      localwatcher.push('VTOL_STATUS', {state: 'WAITING'});
      console.log('Started state ' + 'WAITING');
    },
  };
})();

let ErrorState = (() => {
  let hasAlarms = () => {
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
  }
  return {
    priority: 20,
    canTrigger: () => {
      return hasAlarms();
    },
    start: () => {
      localwatcher.push('VTOL_STATUS', {state: 'ERROR'});
      undirtyWatcherAndSend();
      process.exit();
      console.log('Started state ' + 'ERROR');
    },
    update: hasAlarms,
  };
})()

MockStates.Error = ErrorState;

/**
 *  real states
 */

var States = {};

States.Idle = (() => {
  return {
    start: () => {
      localwatcher.push('VTOL_STATUS', {state: 'IDLE'});
      console.log('Started state ' + 'IDLE');
    }
  };
})();

States.TakingOff = (() => {
  const steps = {
    SETUP_GCS: 'SETUP_GCS',
    ZERO_THROTTLE: 'ZERO_THROTTLE',
    STABILIZED_MOD: 'STABILIZED_MOD',
    TEST_ACTUATORS: 'TEST_ACTUATORS',
  };
  var step = steps.SETUP_GCS;

  return {
    priority: 10,
    canTrigger: () => {
      return shouldTakeOff();
    },
    start: () => {
      step = steps.SETUP_GCS;
      localwatcher.push('VTOL_STATUS', {state: 'TAKINGOFF'});
      console.log('Started state ' + 'TAKINGOFF');
    },
    update: () => {
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
    end: () => {
    }
  };
})();

States.Landing = (() => {
  var working = false;
  return {
    priority: 10,
    canTrigger: () => {
      return shouldLand();
    },
    start: () => {
      localwatcher.push('VTOL_STATUS', {state: 'LANDING'});
      working = true;
      setTimeout(() => {
        working = false;
      }, 3000);
      console.log('Started state ' + 'LANDING');
    },
    update: () => {
      return working;
    },
    end: () => {
    }
  };

})();

States.Loitering = (() => {
  var working = false;
  return {
    priority: 5,
    canTrigger: () => {
      return shouldLoiter();
    },
    start: () => {
      localwatcher.push('VTOL_STATUS', {state: 'LOITERING'});
      working = true;
      setTimeout(() => {
        working = false;
      }, 1000);
      console.log('Started state ' + 'LOITERING');
    },
    update: () => {
      return working;
    },
    end: () => {
    }
  };

})();

States.GoingTo = (() => {
  var working = false;
  return {
    priority: 5,
    canTrigger: () => {
      return shouldGoto();
    },
    start: () => {
      localwatcher.push('VTOL_STATUS', {state: 'GOINGTO'});
      working = true;
      setTimeout(() => {
        working = false;
      }, 10000);
      console.log('Started state ' + 'GOINGTO');
    },
    update: () => {
      return working;
    },
    end: () => {
    }
  };
})();

States.Waiting = (() => {
  return {
    priority: 1,
    canTrigger: () => {
      return shouldWait();
    },
    start: () => {
      localwatcher.push('VTOL_STATUS', {state: 'WAITING'});
      console.log('Started state ' + 'WAITING');
    },
  };
})();

States.Error = ErrorState;

function initStates() {
  const s = (MOCK_STATES ? MockStates : States);

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
setInterval(() => {
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

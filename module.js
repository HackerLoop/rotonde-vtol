#!/usr/bin/env node --harmony

'use strict';

const MOCK_STATES = false;

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
  const WATCHED_UAVO = ['ACTUATORCOMMAND', 'FLIGHTSTATUS', 'SYSTEMALARMS', 'BAROALTITUDE', 'ALTITUDEHOLDDESIRED', 'GCSRECEIVER', 'MANUALCONTROLSETTINGS'];

  client.definitionHandlers.attach('*', (definition) => {
    const identifier = definition.identifier;

    if (identifier.startsWith('SET_') && identifier.endsWith('META')) {
      const getterIdentifier = identifier.replace('SET_', 'GET_');
      const updateIdentifier = identifier.replace('SET_', '');
      if (_.includes(WATCHED_UAVO, updateIdentifier.replace('META', '')) == false) {
        return
      }
      client.bootstrap(_.set({}, getterIdentifier, {}), [updateIdentifier], [], 5000).then((values) => {
        let e = values[0];
        let modes = (e.data.modes & 207) | 16;

        let value = {
          "modes": modes, "periodFlight": 500, "periodGCS": 0, "periodLog": 0,
        };
        uavwatcher.push(updateIdentifier, value).done();

        if (e.data.modes == modes) {
          return;
        }

        client.sendAction(identifier, value);
      }, (errors) => {
        console.log(errors);
        process.exit()
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
                   _.reduce(WATCHED_UAVO, (result, identifier) => result.push(identifier, 'GET_' + identifier, 'SET_' + identifier) && result, []), 5000
  ).then((values) => {
      // load initial values for the requested uavs
      console.log('subscribing to WATCHED_UAVO');
      _.forEach(values, (value) => {
        uavwatcher.push(value.identifier, value.data).done();
        client.eventHandlers.attach(value.identifier, (e) => {
          uavwatcher.push(e.identifier, e.data).done();
        });
      });

      setupFC();
      addLocalDefinitions();
      initStates();
    },
    (errors) => {
      console.error(errors);
      process.exit();
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

let machine;

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

let MockStates = {};

MockStates.Idle = (() => {
  return {
    start: () => {
      localwatcher.push('VTOL_STATUS', {state: 'IDLE'});
      console.log('Started state IDLE');
    }
  };
})();

MockStates.TakingOff = (() => {
  let working = false;
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
      console.log('Started state TAKINGOFF');
    },
    update: () => {
      return working;
    },
    end: () => {
    }
  };
})();

MockStates.Landing = (() => {
  let working = false;
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
      console.log('Started state LANDING');
    },
    update: () => {
      return working;
    },
    end: () => {
    }
  };

})();

MockStates.Loitering = (() => {
  let working = false;
  return {
    priority: 5,
    canTrigger: () => {
      return shouldLoiter();
    },
    start: () => {
      localwatcher.push('VTOL_STATUS', {state: 'LOITERING'});
      working = true;
      console.log('Started state LOITERING');
    },
    update: () => {
      return shouldLoiter();
    },
    end: () => {
    }
  };

})();

MockStates.GoingTo = (() => {
  let working = false;
  let currentPosition = {latitude: 0, longitude: 0};
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
      console.log('Started state GOINGTO');
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
      console.log('Started state WAITING');
    },
  };
})();

let ErrorState = (() => {
  let hasAlarms = () => {
    let error = false;
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
      console.log('Started state ERROR');
    },
    update: hasAlarms,
  };
})()

MockStates.Error = ErrorState;

/**
 *  real states
 */

let States = {};

States.Idle = (() => {
  return {
    start: () => {
      localwatcher.push('VTOL_STATUS', {state: 'IDLE'});
      console.log('Started state IDLE');
    }
  };
})();

States.TakingOff = (() => {
  let machine;

  let createTestActuators = () => {
    return {
      priority: 20,
      start() {
        console.log('Started TestActuators stage');
        flightMode('Stabilized1');
        setPeriodic('ACTUATORCOMMAND', true, 100);
      },
      update() {
        gcsReceiverChannel(0, -0.9);
        return this._checkActuators();
      },
      end() {
        setPeriodic('ACTUATORCOMMAND', false, 0);
        gcsReceiverChannel(0, -1);
      },
      next: createTakeOff(),
      _checkActuators() {
        let channels = uavwatcher.get('ACTUATORCOMMAND').Channel;
        let allDefault = true;
        let diff = -10000;
        _.forEach(channels, (channel1) => {
          _.forEach(channels, (channel2) => {
            allDefault = channel1 == 1000 && channel2 == 1000 ? allDefault : false;
            let newDiff = Math.abs(channel1 - channel2);
            if (newDiff > diff) {
              diff = newDiff;
            }
          });
        });
        if (!allDefault && diff < 300) {
          return false;
        }
        return true;
      }
    };
  }

  let createTakeOff = () => {
    return {
      priority: 40,
      start() {
        console.log('Started TakeOff stage');
        this.currentThrottle = -0.9;
        flightMode('AltitudeHold');
        setPeriodic('BAROALTITUDE', true, 50)
      },
      update() {
        let altitude = uavwatcher.get('BAROALTITUDE');
        this.currentThrottle += (0 - this.currentThrottle) * 0.05;
        gcsReceiverChannel(0, this.currentThrottle);
        return true;
      },
      end() {
        setPeriodic('BAROALTITUDE', false, 0)
      }
    };
  };

  return {
    priority: 10,
    canTrigger: () => {
      return shouldTakeOff();
    },
    start: () => {
      machine = StateMachine.newMachine();
      machine.addState(createTestActuators());

      localwatcher.push('VTOL_STATUS', {state: 'TAKINGOFF'});
      console.log('Started state TAKINGOFF');
    },
    update: () => {
      return machine.update();
    },
    end: () => {
      if (machine) {
        machine.end();
      }
    }
  };
})();

States.Landing = (() => {
  let working = false;
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
      console.log('Started state LANDING');
    },
    update: () => {
      return working;
    },
    end: () => {
    }
  };

})();

States.Loitering = (() => {
  let working = false;
  return {
    priority: 5,
    canTrigger: () => {
      return shouldLoiter();
    },
    start: () => {
      localwatcher.push('VTOL_STATUS', {state: 'LOITERING'});
      working = true;
      console.log('Started state LOITERING');
    },
    update: () => {
      return shouldLoiter();
    },
    end: () => {
    }
  };

})();

States.GoingTo = (() => {
  let working = false;
  let currentPosition = {latitude: 0, longitude: 0};
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
      console.log('Started state GOINGTO');
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
      console.log('Started state WAITING');
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
    client.sendAction('SET_' + container.identifier, container.currentValue.value);
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
  MIN: 0,
  MED: 1000,
  MAX: 2000
};

function setPeriodic(identifier, onUpdate, period) {
  let metaIdentifier = identifier + 'META';
  let value = uavwatcher.getInitialValue(metaIdentifier);
  if (_.isEqual({}, value)) {
    return;
  }
  uavwatcher.push(metaIdentifier, {
    modes: onUpdate ? value.modes | 16 : value.modes,
    periodFlight: period,
  });
}

function setupFC() {
  uavwatcher.push('MANUALCONTROLSETTINGS', {
    ArmTime: '1000',
    ArmTimeoutAutonomous: 'DISABLED',
    ArmedTimeout: 0,
    Arming: 'Always Armed',
    ChannelGroups: {
      Accessory0: 'None',
      Accessory1: 'None',
      Accessory2: 'None',
      Arming: 'None',
      Collective: 'None',
      FlightMode: 'None',
      Pitch: 'GCS',
      Roll: 'GCS',
      Throttle: 'GCS',
      Yaw: 'GCS'
    },
    ChannelMax: {
      Accessory0: 0,
      Accessory1: 0,
      Accessory2: 0,
      Arming: 0,
      Collective: 0,
      FlightMode: 0,
      Pitch: GCSReceiverChannelValues.MAX,
      Roll: GCSReceiverChannelValues.MAX,
      Throttle: GCSReceiverChannelValues.MAX,
      Yaw: GCSReceiverChannelValues.MAX
    },
    ChannelMin: {
      Accessory0: 0,
      Accessory1: 0,
      Accessory2: 0,
      Arming: 0,
      Collective: 0,
      FlightMode: 0,
      Pitch: GCSReceiverChannelValues.MIN,
      Roll: GCSReceiverChannelValues.MIN,
      Throttle: GCSReceiverChannelValues.MIN,
      Yaw: GCSReceiverChannelValues.MIN
    },
    ChannelNeutral: {
      Accessory0: 0,
      Accessory1: 0,
      Accessory2: 0,
      Arming: 0,
      Collective: 0,
      FlightMode: 0,
      Pitch: GCSReceiverChannelValues.MED,
      Roll: GCSReceiverChannelValues.MED,
      Throttle: GCSReceiverChannelValues.MIN,
      Yaw: GCSReceiverChannelValues.MED
    },
    ChannelNumber: {
      Accessory0: 0,
      Accessory1: 0,
      Accessory2: 0,
      Arming: 0,
      Collective: 0,
      FlightMode: 0,
      Pitch: 3,
      Roll: 2,
      Throttle: 1,
      Yaw: 4
    },
    Deadband: 0,
    DisarmTime: '2000',
    FlightModeNumber: 1,
    FlightModePosition: [
      'Stabilized1',
      'Stabilized1',
      'Stabilized1',
      'Stabilized1',
      'Stabilized1',
      'Stabilized1'
    ],
    RssiChannelNumber: 0,
    RssiMax: 2000,
    RssiMin: 1000,
    RssiType: 'None',
    Stabilization1Settings: {
      Pitch: 'Attitude',
      Roll: 'Attitude',
      Yaw: 'Rate'
    },
    Stabilization2Settings: {
      Pitch: 'Attitude',
      Roll: 'Attitude',
      Yaw: 'Rate'
    },
    Stabilization3Settings: {
      Pitch: 'Attitude',
      Roll: 'Attitude',
      Yaw: 'Rate'
    }
  }
                 );

  uavwatcher.push('GCSRECEIVER', {
    Channel: [GCSReceiverChannelValues.MIN,
              GCSReceiverChannelValues.MED,
              GCSReceiverChannelValues.MED,
              GCSReceiverChannelValues.MED,
              GCSReceiverChannelValues.MIN,
              GCSReceiverChannelValues.MIN,
              GCSReceiverChannelValues.MIN,
              GCSReceiverChannelValues.MIN]
  });
}

// value is between -1 and 1, the function then interpolates
// to set the right value based on channel min/med/max
function gcsReceiverChannel(channel, value) {
  const gcsReceiver = _.cloneDeep(uavwatcher.get('GCSRECEIVER'));
  let convert = 0;

  if (value < 0) {
    convert = GCSReceiverChannelValues.MED + (GCSReceiverChannelValues.MED - GCSReceiverChannelValues.MIN) * value;
  } else if (value > 0) {
    convert = GCSReceiverChannelValues.MED + (GCSReceiverChannelValues.MAX - GCSReceiverChannelValues.MED) * value;
  }

  gcsReceiver.Channel[channel] = convert;
  uavwatcher.push('GCSRECEIVER', gcsReceiver).forceDirty();
}

/**
 * 'AltitudeHold'
 * 'Stabilized1',
 * 'ReturnToHome'
 * 'PositionHold'
 */
function flightMode(flightMode) {
  let manualControlSettings = uavwatcher.get('MANUALCONTROLSETTINGS');
  let FlightModePosition = [
    flightMode,
    'Stabilized1',
    'Stabilized1',
    'Stabilized1',
    'Stabilized1',
    'Stabilized1'
  ];
  uavwatcher.push('MANUALCONTROLSETTINGS', {
    FlightModePosition,
  });
}

function loiterCommand(loiterCommand) {

}

/**
 *  Watchdog
 */

let lastUpdate = -1; // watchdog, tracks last update received as a UNIX timestamp,
                     // triggers IDLE status when exceeds MAX_PINGLESS_TIME seconds
setInterval(() => {
  if (lastUpdate === -1) {
    return;
  }
  let time = new Date().getTime();
  if (time - lastUpdate > MAX_PINGLESS_TIME) {
    console.log('Watchdog fired !');
    localwatcher.push('VTOL_STATUS', {status: 'IDLE'})
    lastUpdate = -1;
  }
}, 500);

var _ = require('lodash');

function createStates(SKYBOT_ID, initialSkybotValue, uavwatcher, states, statuses, controlTypes) {
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
    var working = false;
    return {
      priority: 10,
      canTrigger: function() {
        var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);
        return skybotValue.status === statuses.CONNECTED &&
          skybotValue.takeoff === true &&
          skybotValue.state === states.IDLE;
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

  States.Landing = (function() {
    var working = false;
    return {
      priority: 10,
      canTrigger: function() {
        var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);
        return (
          (skybotValue.status === statuses.CONNECTED && skybotValue.takeoff === false) ||
            skybotValue.status === statuses.IDLE
        ) &&
          skybotValue.state !== states.IDLE &&
          skybotValue.state !== states.LANDING;
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
        var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);
        return skybotValue.controlType === controlTypes.LOITER &&
          skybotValue.status === statuses.CONNECTED &&
          skybotValue.takeoff === true &&
          skybotValue.state === states.WAITING &&
          skybotValue.forward !== 0 && skybotValue.left !== 0 && skybotValue.up !== 0;
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
        var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);
        return skybotValue.controlType === controlTypes.GOTO &&
          skybotValue.status === statuses.CONNECTED &&
          skybotValue.takeoff === true &&
          skybotValue.state === states.WAITING;
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
        var skybotValue = uavwatcher.valueForUAV(SKYBOT_ID);
        return skybotValue.status === statuses.CONNECTED &&
          skybotValue.takeoff === true;
      },
      start: function() {
        uavwatcher.addOrUpdateUAV(SKYBOT_ID, {state: states.WAITING, forward: 0, left: 0, up: 0}, true);
      },
    };
  })();

  return States;
}

module.exports = createStates;

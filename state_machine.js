/**
 * State definition (all optionals):
 *  {
 *      priority: [int],
 *      canTrigger: [function],
 *      start: [function],
 *      update: [function],
 *      end: [function],
 *      next: [state]
 *  }
 */

var newMachine = function() {
  var machine = {};

  var currentState = null;
  var states = [];

  var assertState = function(state) {
    state.priority = state.priority || 0;
    state.next = null;
    state.canTrigger = state.canTrigger || function() {return true;};
    state.start = state.start || function() {};
    state.update = state.update || function() {return true;};
    state.end = state.end || function() {};
  };

  machine.update = function() {
    var replacingState, state, i;

    if (currentState) {
      if (currentState.update.apply(currentState, arguments) === false) {
        currentState.end();
        if (currentState.next) {
          assertState(currentState.next);
          currentState = currentState.next;
          currentState.start();
          return;
        }
        currentState = null;
      }
    }

    replacingState = currentState;
    for (i = 0; i < states.length; ++i) {
      state = states[i];
      if (state == currentState)
        continue;
      if (state.canTrigger() && (!currentState || state.priority >= replacingState.priority)) {
        replacingState = state;
      }
    }

    if (replacingState !== currentState) {
      if (currentState)
        currentState.end();
      currentState = replacingState;
      currentState.start();
    }
  };

  machine.addState = function(state) {
    assertState(state);
    states.push(state);
  };

  return machine;
}

module.exports = {
  newMachine: newMachine,
}

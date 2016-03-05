'use strict';
// TODO: Rename StateMachine into BehavioralTree
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

let newMachine = function() {
  let machine = {};

  let currentState = null;
  let states = [];

  let assertState = function(state) {
    state.priority = state.priority || 0;
    state.next = state.next || null;
    state.canTrigger = state.canTrigger || function() {return true;};
    state.start = state.start || function() {};
    state.update = state.update || function() {return true;};
    state.end = state.end || function() {};
  };

  machine.update = function() {
    let replacingState, state, i;

    if (currentState) {
      if (currentState.update.apply(currentState, arguments) === false) {
        currentState.end();
        if (currentState.next) {
          assertState(currentState.next);
          currentState = currentState.next;
          currentState.start();
          return true;
        } else if (states.length == 0) {
	  return false;
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

    return currentState;
  };

  machine.addState = function(state) {
    assertState(state);
    states.push(state);
  };

  machine.end = function() {
    if (!currentState) {
      return;
    }
    currentState.end();
  }

  machine.setState = function(state) {
    if (currentState) {
	currentState.end();
    }
    currentState = state;
    currentState.start();
  }

  return machine;
}

module.exports = {
  newMachine: newMachine,
}

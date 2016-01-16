'use strict';

var _ = require('lodash');

class UAVContainer {

  constructor(identifier, value) {
    this.identifier = identifier;
    this.previousValues = [];
    this.currentValue = {value: _.cloneDeep(value), timeFrom: new Date().getTime(), timeTo: null};
    this.initialValue = _.cloneDeep(this.currentValue);
    this.dirty = true;
  }

  lastUpdate() {
    return this.currentValue.timeFrom;
  }

  update(val) {
    var newValue = _.merge({}, this.currentValue.value, val);
    if (_.isEqual(this.currentValue.value, newValue)) {
      return;
    }
    this.currentValue.value = newValue;
    this.dirty = true;
  }

  reset() {
    this.update(this.initialValue.value);
  }

  done() {
    var value = _.cloneDeep(this.currentValue);
    value.timeTo = new Date().getTime();
    this.previousValues.push(value);

    if (this.previousValues.length > 100) {
      this.previousValues.shift();
    }

    this.currentValue.timeFrom = new Date().getTime();
    this.currentValue.timeTo = null;
    this.dirty = false;
  }
}

class UAVWatcher {

  constructor() {
    this.containers = {};
  }

  // value is what you get from the payload.data field of an update
  push(identifier, value) {
    var container = this.containers[identifier];
    if (container === undefined) {
      container = new UAVContainer(identifier, value);
      this.containers[identifier] = container;
    } else {
      container.update(value);
    }
    return container;
  }

  forEachDirty(fn) {
    _.forEach(this.containers, function(container) {
      if (container.dirty) {
        fn(container);
      }
    });
  }

  get(identifier) {
    var container = this.containers[identifier];
    return container ? container.currentValue.value : {};
  }

  reset(identifier) {
    var container = this.containers[identifier];
    container.reset();
    return container ? container.currentValue.value : {};
  }
}

module.exports = UAVWatcher;

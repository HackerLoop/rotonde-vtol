'use strict';

var _ = require('lodash');

class UAVContainer {

  constructor(objectId, value) {
    this.objectId = objectId;
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

  constructor(definitionsStore) {
    this.definitionsStore = definitionsStore;
    this.containers = {};
  }

  objectIdOrName(objectIdOrName) {
    var objectId;

    if (isNaN(parseInt(objectIdOrName))) {
      var definition = this.definitionsStore.getDefinitionByName(objectIdOrName);
      if (_.isUndefined(definition)) {
        return null;
      }
      objectId = definition.id;
    } else {
      objectId = objectIdOrName;
    }

    return objectId;
  }

  // value is what you get from the payload.data field of an update
  push(objectIdOrName, value) {
    var objectId = this.objectIdOrName(objectIdOrName);

    var container = this.containers[objectId];
    if (container === undefined) {
      container = new UAVContainer(objectId, value);
      this.containers[objectId] = container;
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

  valueForUAV(objectIdOrName) {
    var objectId = this.objectIdOrName(objectIdOrName);

    var container = this.containers[objectId];
    return container ? container.currentValue.value : {};
  }

  resetUAV(objectIdOrName) {
    var objectId = this.objectIdOrName(objectIdOrName);

    var container = this.containers[objectId];
    container.reset();
    return container ? container.currentValue.value : {};
  }
}

module.exports = UAVWatcher;

'use strict';

var _ = require('lodash');

function equals(o, p) {
  var i,
  keysO = Object.keys(o).sort(),
    keysP = Object.keys(p).sort();
  if (keysO.length !== keysP.length)
    return false;//not the same nr of keys
  if (keysO.join('') !== keysP.join(''))
    return false;//different keys
  for (i=0;i<keysO.length;++i) {
    if (o[keysO[i]] instanceof Array) {
      if (!(p[keysO[i]] instanceof Array))
        return false;
      //if (compareObjects(o[keysO[i]], p[keysO[i]] === false) return false
      //would work, too, and perhaps is a better fit, still, this is easy, too
      if (p[keysO[i]].sort().join('') !== o[keysO[i]].sort().join(''))
        return false;
    }
    else if (o[keysO[i]] instanceof Date) {
      if (!(p[keysO[i]] instanceof Date))
        return false;
      if ((''+o[keysO[i]]) !== (''+p[keysO[i]]))
        return false;
    }
    else if (o[keysO[i]] instanceof Function) {
      if (!(p[keysO[i]] instanceof Function))
          return false;
        //ignore functions, or check them regardless?
    }
    else if (o[keysO[i]] instanceof Object) {
      if (!(p[keysO[i]] instanceof Object))
        return false;
      if (o[keysO[i]] === o) {
        if (p[keysO[i]] !== p)
          return false;
      } else if (compareObjects(o[keysO[i]], p[keysO[i]]) === false)
          return false;//WARNING: does not deal with circular refs other than ^^
    }
    if (o[keysO[i]] !== p[keysO[i]])//change !== to != for loose comparison
      return false;//not the same value
  }
  return true;
}

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
    if (equals(this.currentValue.value, val)) {
      return;
    }
    this.currentValue.value = _.merge(this.currentValue.value, val);
    this.dirty = true;
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
  addOrUpdateUAV(objectIdOrName, value) {
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
}

module.exports = UAVWatcher;

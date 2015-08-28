'use strict';

var Client = require('skybot-client');

var client = Client('ws://127.0.0.1:4224/uav');

client.onReady(function() {
  console.log('ready');
});

process.on('exit', function(code) {
  console.log("About to exit");
});

client.requireDefinitions(['GCSReceiver', 'GCSReceiverMeta', 'ManualControlCommand']).then(
  function(definitions) {
    console.log('all definitions', definitions);
    return client.requestValuesForUavs(['GCSReceiver', 'GCSReceiverMeta', 'ManualControlCommand']);
  }
).then(
  function(values) {
    console.log(values);
  },
  function(errors) {
    console.log(errors);
  }
);

client.connect();

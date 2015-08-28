'use strict';

var Client = require('skybot-client');

var client = Client('ws://127.0.0.1:4224/uav');

client.onReady(function() {
  console.log('ready');
});

process.on('exit', function(code) {
  console.log("About to exit");
});

client.definitionHandlers.attachOnce('GCSReceiver', function(definition) {
  client.updateHandlers.attachOnce('GCSReceiver', function(uav) {
    console.log(uav);
  });
  client.connection.sendRequest('GCSReceiver');
});

client.definitionHandlers.attachOnce('GCSReceiverMeta', function(definition) {
});

client.definitionHandlers.attachOnce('ManualControlCommand', function(definition) {
});

client.connect();

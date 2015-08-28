'use strict';

var Client = require('skybot-client');

var client = Client('ws://127.0.0.1:4224/uav', {debug: false});

client.onReady(function() {
  client.requestValuesForUavs(['GCSReceiver', 'GCSReceiverMeta', 'ManualControlCommand']).then(
    function(values) {
      console.log(values);
    },
    function(errors) {
      console.log(errors);
    }
  );
});

process.on('exit', function(code) {
  console.log("About to exit");
});

client.connect();

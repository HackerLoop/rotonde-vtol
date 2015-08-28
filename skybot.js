'use strict';

var Client = require('skybot-client');

var client = Client('localhost:4224');

client.onReady(function() {
  console.log('ready');
});

client.connect();

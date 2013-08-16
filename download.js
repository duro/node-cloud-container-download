#!/usr/bin/env node

var handler, cli,
    _           = require('lodash')
    Downloader  = require('./lib/Downloader'),
    Migrator    = require('./lib/Migrator'),
    fs          = require('fs'),
    cli         = require('commander'),
    optimist    = require('optimist'),
    configFile  = 'config.json';

cli = optimist.argv;

fs.exists(configFile, function(exists){
  if (exists) {
    fs.readFile(configFile, function (err, data) {
      if (err) throw err;
      var config = JSON.parse(data);

      switch (cli._[0]) {
        case 'download':
          handler = new Downloader(config);
          break;
        case 'migrate':
          handler = new Migrator(config);
          break;
      }

      handler[cli._[1]](done);

      function done(err) {
        if (err) throw err;
        console.log('Done!');
      }

    });
  } else {
    console.log('You must have a config.json file present.');
  }
})

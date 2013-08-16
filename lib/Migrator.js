var path        = require('path'),
    fs          = require('fs'),
    async       = require('async'),
    mongoose    = require('mongoose'),
    ProgressBar = require('progress'),
    File        = require('./models/File');

/* --------------------------------------- */
/* --( Downloader: Constructor )-- */
/* --------------------------------------- */

var Downloader = function(config) {
  this.filesFetched   = false;
  this.config         = config;
  this.marker         = null;
  this.progress       = null;
  this.page           = 0;

  this.fromClient = require('pkgcloud').storage.createClient({
    provider: this.config.from.provider,
    username: this.config.from.keyId,
    apiKey: this.config.from.key
  });

  this.toClient = require('pkgcloud').storage.createClient({
    provider: this.config.to.provider,
    keyId: this.config.to.keyId,
    key: this.config.to.key,
    acl: this.config.to.options.acl
  });

  mongoose.connect('mongodb://localhost/migrator');

  if (this.config.options.logFile) {
    if (this.config.options.logFile.charAt(0) !== '/' && this.config.options.logFile.charAt(0) !== '~') {
      this.config.options.logFile = path.join(__dirname, '../', this.config.options.logFile);
    }
  }
}

exports = module.exports = Downloader;

/* --------------------------------------- */
/* --( Downloader: Public Methods )-- */
/* --------------------------------------- */

Downloader.prototype.start = function(done) {
  async.series([
    getFiles.bind(this),
    fetchFilesFromDB.bind(this),
    reattemptFailedFiles.bind(this)
  ], done);
}

Downloader.prototype.resume = function(done) {
  async.series([
    fetchFilesFromDB.bind(this),
    reattemptFailedFiles.bind(this)
  ], done);
}

Downloader.prototype.allFilesFetched = function() {
  return this.filesFetched;
}

Downloader.prototype.out = function(msg) {
  if (this.config.options.cli && this.config.options.logFile) {
      fs.appendFile(this.config.options.logFile, msg + "\n");
  } else {
    console.log(msg);
  }
}

/* --------------------------------------- */
/* --( Downloader: Private Methods )-- */
/* --------------------------------------- */

function ensureDownloadDestination(done) {
  var dirToCreate = path.join(__dirname, '../', this.config.from.saveTo);

  if (this.config.from.prefix) {
    dirToCreate = path.join(dirToCreate, this.config.from.prefix);
  }

  fs.exists(dirToCreate, function(exists){
    if (!exists) {
      fs.mkdir(dirToCreate, done);
    } else {
      done();
    }
  });
}

function getFiles(done) {
  async.until(
    this.allFilesFetched.bind(this),
    fetchFilesFromCloud.bind(this),
    done
  );
}

function fetchFilesFromCloud(done) {
  var _this   = this,
      timeout = 60000,
      retries = 3,
      options = {
        marker: this.marker,
        prefix: this.config.from.prefix
      };

  this.page++;
  console.log('Fetching page ' + this.page + ' from cloud...');

  this.fromClient.getFiles(this.config.from.container, options, function(err, files){
    if (err) return done(err);
    if (files.length > 0) {
      async.each(files, saveFileToDB, function(err){
        if (err) return done(err);
        _this.marker = files[files.length - 1]['name'];
        done();
      });
    } else {
      _this.filesFetched = true;
      done();
    }
  })
}

function saveFileToDB(file, done) {
  File.findOneAndUpdate({name: file.name}, file, {upsert: true}, done);
}

function fetchDirectoriesFromDB(done) {
  var _this = this;
  File.where('contentType', 'application/directory')
    .sort({name: 'asc'})
    .exec(function(err, files){
      if (err) return done(err);
      console.log('Creating directory tree...');
      async.eachSeries(files, processModelFromDB.bind(_this), done);
    });
}

function fetchFilesFromDB(done) {
  var _this = this;
  File.where('contentType').ne('application/directory')
    .exec(function(err, files){
      if (err) return done(err);
      console.log('Processing file downloads...');
      startProgressBar.apply(_this, [files.length]);
      async.eachLimit(files, _this.config.options.concurrency, processModelFromDB.bind(_this), done);
    });
}

function reattemptFailedFiles(done) {
  var _this = this;
  File.where('contentType').ne('application/directory')
    .where('failed', true)
    .exec(function(err, files){
      if (err) return done(err);
      if (files.length > 0) {
        console.log('Reattempting failed files...');
        startProgressBar.apply(_this, [files.length]);
        async.eachLimit(files, _this.config.options.concurrency, processModelFromDB.bind(_this), done);
      } else {
        done();
      }
    });
}

function processModelFromDB(fileModel, done) {
  if (fileModel.get('contentType') == "application/directory") {
    processDirectory.apply(this, [fileModel, done]);
  } else {
    processFile.apply(this, [fileModel, done]);
  }
}

function processFile(fileModel, done) {
  var _this       = this,
      dlConfig    = {
        container: this.config.from.container,
        remote: fileModel.get('name')
      },
      upConfig    = {
        container: this.config.to.container,
        remote: fileModel.get('name')
      };

  if (this.config.to.provider == 'amazon') {
    if (this.config.to.acl) {
      upConfig.headers = upConfig.headers || {};
      upConfig.headers["x-amz-acl"] = this.config.to.acl;
    }
  }

  this.fromClient
    .download(dlConfig, function(err, dlFile) {
      if (err) {
        fileModel.set('failed', true);
        fileModel.save();
      }
    })
    .pipe(this.toClient.upload(upConfig, function(err, upFile){
      _this.progress.tick();
      if (err) {
        fileModel.set('failed', true);
        fileModel.save(done);
      } else {
        fileModel.remove(done);
      }
    }));
}

function processDirectory(fileModel, done) {
  var _this       = this,
      dirToCreate = path.join(__dirname, '../', this.config.from.saveTo, fileModel.get('name'));

  fs.exists(dirToCreate, function(exists){
    if (!exists) {
      fs.mkdir(dirToCreate, function(err){
        if (err) return done(err);
        done();
      });
    } else {
      done();
    }
  });
}

function startProgressBar(total) {
  this.progress = new ProgressBar('[:bar] :percent (:current/:total) :etas', {
    total: total,
    complete: '=',
    incomplete: ' ',
    width: 100
  });
}

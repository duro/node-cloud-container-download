var mongoose    = require('mongoose'),
    Schema      = mongoose.Schema;

/* --------------------------------------- */
/* --( File Model )-- */
/* --------------------------------------- */

var File = mongoose.model('File', new Schema({
  name:  {type: String, index: true},
  contentType: String,
  lastModified:   Date,
  container: String,
  bytes: Number,
  size: Number,
  failed: {type: Boolean, default: false}
}));

exports = module.exports = File;
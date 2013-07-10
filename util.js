var graph  = require('fbgraph')
  , fs     = require('fs')
  , AdmZip = require('adm-zip');

exports.processFile = function(path) {
  var zip = new AdmZip(path);
  var zipEntries = zip.getEntries();

  zip.readAsTextAsync(zipEntries[0], function(data) {
    console.log(data);
  });
};

exports.parseHTMLFile = function(data) {
  
};

exports.createFBNote = function(title, message) {
  var note = {
      subject: title
    , message: message
  };

  graph.post('me/notes', note, function (err, res) {
    console.log(res);
  });
}
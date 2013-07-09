var fs     = require('fs')
  , AdmZip = require('adm-zip');

exports.processFile = function(path) {
  var zip = new AdmZip(path);
  var zipEntries = zip.getEntries();

  zipEntries.forEach(function(zipEntry) {
    console.log(zipEntry.entryName.toString());
  });
};
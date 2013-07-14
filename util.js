var app       = require('./app.js')
  , cheerio   = require('cheerio')
  , graph     = require('fbgraph')
  , fs        = require('fs')
  , AdmZip    = require('adm-zip')
  , Validator = require('validator').Validator;

exports.validateFile = function(file) {
  Validator.prototype.error = function (msg) {
      this._errors.push(msg);
      return this;
  }

  Validator.prototype.getErrors = function () {
      return this._errors;
  }

  var validator = new Validator();

  validator.check(
    file.name,
    'File must be named "archive.zip" (without quotes)'
  ).equals('archive.zip');

  validator.check(
    file.type,
    'File must be in zip format'
  ).equals('application/x-zip-compressed');

  return validator.getErrors();
}

exports.getPrivacySetting = function(callback) {
  var privacyMap = {};
  privacyMap['SELF'] = 'Only Me';
  privacyMap['FRIENDS_OF_FRIENDS'] = 'Friends of Friends';
  privacyMap['ALL_FRIENDS'] = 'Friends';
  privacyMap['CUSTOM'] = 'Custom';
  privacyMap['EVERYONE'] = 'Public';

  var query = 'SELECT value FROM privacy_setting WHERE name=\'default_stream_privacy\'';

  graph.fql(query, function(err, res) {
    var value = res.data[0].value;

    callback(privacyMap[value]);
  })
};

exports.processFile = function(sessionID, path) {
  if (path === undefined) {
    return;
  }

  var zip = new AdmZip(path);
  var zipEntries = zip.getEntries();

  app.io.sockets.in(sessionID).emit(
    'init processing',
    { numFiles: zipEntries.length}
  );

  var index = 0;

  // recursion so that we post the notes chronologically
  function parseZipEntry() {
    if (index < zipEntries.length) {
      app.io.sockets.in(sessionID).emit(
        'file start',
        { filename: zipEntries[index].entryName }
      );

      parseHTMLFile(sessionID, zip.readAsText(zipEntries[index]), function () {
        index++;
        app.io.sockets.in(sessionID).emit('file complete');
        parseZipEntry();
      });
    } else {
      // delete the files
      fs.unlink(path);
      delete app.SESSION_FILEPATH_MAP[sessionID];
      app.io.sockets.in(sessionID).emit('processing complete');
    }
  }
  parseZipEntry();
};

function parseHTMLFile(sessionID, data, callback) {
  var $ = cheerio.load(data);

  // filter out comment titles
  var titles = $('.blogheader').filter(function(i, elem) {
    return $(this).text().indexOf('Comments') === -1;
  }).toArray().reverse();

  var index = 0;

  // recursion to force synchronous looping over all the blog posts to maintain
  // chronological order.
  function postNoteFromBlog() {
    if (index < titles.length) {
      var data = getBlogData($, titles[index]);
      createFBNote(sessionID, data.title, data.message, function() {
        index++;
        postNoteFromBlog();
      });
    } else {
      callback();
    }
  }
  postNoteFromBlog();
};

function getBlogData($, elem) {
  var title = $(elem).text();
  var titleSibling = $(elem).next();
  var commentTitle = titleSibling.next().next();

  var message = $(titleSibling).html();

  // add comments, if any
  if (commentTitle.length !== 0 &&
      commentTitle.text().indexOf('Comments') !== -1) {
    var comments = commentTitle.next();

    message += '<P>&nbsp;</P>';
    message += '<span style="text-decoration: underline; font-weight: bold">' +
      commentTitle.text() + '</span>';
    message += comments.html();
  }

  return { 'title': title, 'message': message };
}

function createFBNote(sessionID, title, message, callback) {
  var note = {
      subject: title
    , message: message
  };

  graph.post('me/notes', note, function (err, res) {
    app.io.sockets.in(sessionID).emit(
      'create note',
      { title: title, response: res }
    );
    console.log(title);
    console.log(res);
    callback();
  });
}
var app       = require('./app.js')
  , cheerio   = require('cheerio')
  , graph     = require('fbgraph')
  , fs        = require('fs')
  , AdmZip    = require('adm-zip')
  , Validator = require('validator').Validator;

exports.validateRequest = function(sessionID, file) {
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

  var isValidFiletype = false;
  if (file.type === 'application/x-zip-compressed' ||
      file.type === 'application/zip') {
    isValidFiletype = true;
  }

  validator.check(
    isValidFiletype,
    'File must be in zip format'
  ).equals(true);

  var isNewUpload = app.SESSIONID_DATA_MAP[sessionID] === undefined;
  validator.check(
    isNewUpload,
    'You just recently started the importing process.  Please view the ' +
    'status of your import <a href="http://xanga.meltedxice.c9.io/status"' +
    '>here</a>.'
  ).equals(true);

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
    graph.get('me?fields=name', function (err2, res2) {
      callback(res2.name, privacyMap[value]);
    });
  });
};

exports.processFile = function(sessionID) {
  var sessionData = app.SESSIONID_DATA_MAP[sessionID];
  if (!sessionData) {
    return;
  } else if (sessionData.started === true) {
    app.io.sockets.in(sessionID).emit(
      'resume processing',
      {
        numFiles: sessionData.numFiles,
        currentIndex: sessionData.currentIndex
      }
    );
    return;
  }

  var zip = new AdmZip(sessionData.filepath);
  var zipEntries = zip.getEntries();

  sessionData.started = true;
  sessionData.numFiles = zipEntries.length;

  app.io.sockets.in(sessionID).emit(
    'init processing',
    { numFiles: sessionData.numFiles }
  );

  var index = 0;

  // recursion so that we post the notes chronologically
  function parseZipEntry() {
    if (index < zipEntries.length) {
      sessionData.currentIndex = index;
      app.io.sockets.in(sessionID).emit(
        'file start',
        {
          filename: zipEntries[index].entryName,
          currentIndex: sessionData.currentIndex
        }
      );

      parseHTMLFile(sessionID, zip.readAsText(zipEntries[index]), function() {
        index++;
        parseZipEntry();
      });
    } else {
      // delete the files
      fs.unlink(sessionData.filepath);

      app.io.sockets.in(sessionID).emit(
        'processing complete',
        {
          notesCreated: sessionData.notes_created,
          notesFailed: sessionData.notes_failed
        }
      );

      delete app.SESSIONID_DATA_MAP[sessionID];
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
  var sessionData = app.SESSIONID_DATA_MAP[sessionID];

  graph.post('me/notes', note, function (err, res) {
    var success = res.id !== undefined;

    graph.get('me?fields=id', function (err2, res2) {
      if (success) {
        app.mixpanel.people.increment(res2.id, 'notes_created');

      } else {
        app.mixpanel.people.increment(res2.id, 'notes_failed');
      }
    });
    app.io.sockets.in(sessionID).emit(
      'create note',
      { title: title, response: res, success: success }
    );

    if (success) {
     sessionData.notes_created++;
    } else {
      sessionData.notes_failed++;
    }

    callback();
  });
}
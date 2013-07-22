var app       = require('./app.js')
  , cheerio   = require('cheerio')
  , graph     = require('fbgraph')
  , fs        = require('fs')
  , AdmZip    = require('adm-zip')
  , Validator = require('validator').Validator;

var orderedMonths = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ];

exports.validateRequest = function(sessionID, file, callback) {
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
      file.type === 'application/zip' ||
      file.type === 'application/x-zip' ||
      file.type === 'application/octet-stream' ||
      file.type === 'application/x-compress' ||
      file.type === 'application/x-compressed' ||
      file.type === 'multipart/x-zip'
    ) {
    isValidFiletype = true;
  }

  validator.check(
    isValidFiletype,
    'File must be in zip format'
  ).equals(true);

  app.client.hget(sessionID, 'started', function(err, started) {
    validator.check(
      started != 1,
      'You just recently started the importing process.  Please <a href="/status">' +
      'view the status of your import</a> or try again in 1 hour.'
    ).equals(true);

    callback(validator.getErrors());
  });
}

exports.getPrivacySetting = function(access_token, callback) {
  var privacyMap = {};
  privacyMap['SELF'] = 'Only Me';
  privacyMap['FRIENDS_OF_FRIENDS'] = 'Friends of Friends';
  privacyMap['ALL_FRIENDS'] = 'Friends';
  privacyMap['CUSTOM'] = 'Custom';
  privacyMap['EVERYONE'] = 'Public';

  var query = 'SELECT value FROM privacy_setting WHERE name=\'default_stream_privacy\'';

  graph
    .setAccessToken(access_token)
    .fql(query, function(err, res) {
    var value = res.data[0].value;
    graph
      .setAccessToken(access_token)
      .get('me?fields=name', function (err2, res2) {
      callback(res2.id, res2.name, privacyMap[value]);
    });
  });
};

exports.processFile = function(sessionID) {
  console.log('%s import is starting on worker %d', sessionID, app.cluster.worker.id);

  app.client.hgetall(sessionID, function(err, sessionData) {
    if (!Object.keys(sessionData).length) {
      return;
    } else if (sessionData.started == 1) {
      app.io.sockets.in(sessionID).emit(
        'resume processing',
        {
          numFiles: sessionData.num_files,
          currentIndex: sessionData.current_index
        }
      );
      return;
    }

    var zip = new AdmZip(sessionData.filepath);
    var zipEntries = zip.getEntries();

    // rearrange entries to be chronological
    var sortedZipEntries = sortFiles(zipEntries);

    app.client.hmset(sessionID, {
        'started': '1'
      , 'num_files': sortedZipEntries.length.toString()
      }
    );

    app.io.sockets.in(sessionID).emit(
      'init processing',
      { numFiles: sortedZipEntries.length }
    );

    var index = 0;

    // recursion so that we post the notes chronologically
    function parseZipEntry() {
      if (index < sortedZipEntries.length) {
        app.client.hset(sessionID, 'current_index', (index + 1).toString());
        app.io.sockets.in(sessionID).emit(
          'file start',
          {
            filename: sortedZipEntries[index].entryName,
            currentIndex: index + 1
          }
        );

        parseHTMLFile(
          sessionID,
          sessionData,
          zip.readAsText(sortedZipEntries[index]),
          function() {
            index++;
            parseZipEntry();
          }
        );
      } else {
        // delete the files
        fs.unlink(sessionData.filepath);

        app.client.hmget(sessionID, 'notes_created', 'notes_failed', function(err, list) {
          app.io.sockets.in(sessionID).emit(
            'processing complete',
            {
              notesCreated: list[0]
            , notesFailed: list[1]
            }
          );

          app.client.del(sessionID);

          console.log('%s import completed on worker %d', sessionID, app.cluster.worker.id);
        });
      }
    }
    parseZipEntry();
  });
};

/**
 * this is the kind of algorithm that gets thought of at 4AM.  basically, get
 * the oldest year and as we iterate through all the entries, get the difference
 * between the entry's year and the oldest year, multiply by 12 (for months),
 * and add the month value (0-11).  That's the index where that entry belongs.
 * What we did was create an array that has a slot for every month and it is
 * only populated when we actually have a file that fits the slot.
 *
 * Before we return the result, we filter and collapse the array so that there
 * are no holes where the element is undefined in the array.
 */
function sortFiles(entries) {
  if (entries[0] === undefined) {
    return [];
  }

  var sortedEntries = [];
  var oldestYear = parseInt(entries[0].entryName.slice(-12, -8), 10);
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var data = entry.entryName.slice(-12).split('_'); // e.g. ["2004", "Apr.htm"]
    var index = (+data[0] - oldestYear) * 12 + orderedMonths.indexOf(data[1].split('.')[0]);
    sortedEntries[index] = entry;
  }

  var filteredSortedEntries = [];
  for (var j = 0; j < sortedEntries.length; j++) {
    if (sortedEntries[j] !== undefined) {
      filteredSortedEntries.push(sortedEntries[j]);
    }
  }

  return filteredSortedEntries;
};

function parseHTMLFile(sessionID, sessionData, data, callback) {
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
      createFBNote(sessionID, sessionData, data.title, data.message, function() {
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

function createFBNote(sessionID, sessionData, title, message, callback) {
  var note = {
      subject: title
    , message: message
  };

  graph
    .setAccessToken(sessionData.access_token)
    .post('me/notes', note, function (err, res) {
    var success = res.id !== undefined;

    graph
      .setAccessToken(sessionData.access_token)
      .get('me?fields=id', function (err2, res2) {
      if (success) {
        app.mixpanel.people.increment(res2.id, 'notes_created');

      } else {
        app.mixpanel.people.increment(res2.id, 'notes_failed');
      }
    });
    /*
    app.io.sockets.in(sessionID).emit(
      'create note',
      { title: title, response: res, success: success }
    );
    */
    if (success) {
      app.client.hincrby(sessionID, 'notes_created', 1);
    } else {
      app.client.hincrby(sessionID, 'notes_failed', 1);
    }

    callback();
  });
}
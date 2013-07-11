var cheerio   = require('cheerio')
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

exports.processFile = function(path) {
  var zip = new AdmZip(path);
  var zipEntries = zip.getEntries();

  var index = 0;

  // recursion so that we post the notes chronologically
  function parseZipEntry() {
    if (index < zipEntries.length) {
      parseHTMLFile(zip.readAsText(zipEntries[index]), function () {
        index++;
        parseZipEntry();
      });
    } else {
      // delete the files
      fs.unlink(path);
    }
  }

  parseZipEntry();
};

function parseHTMLFile(data, callback) {
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
      createFBNote(data.title, data.message, function() {
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

function createFBNote(title, message, callback) {
  var note = {
      subject: title
    , message: message
  };

  graph.post('me/notes', note, function (err, res) {
    console.log(title);
    console.log(res);
    callback();
  });
}
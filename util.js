var cheerio = require('cheerio')
  , graph   = require('fbgraph')
  , fs      = require('fs')
  , AdmZip  = require('adm-zip');

exports.processFile = function(path) {
  var zip = new AdmZip(path);
  var zipEntries = zip.getEntries();

//  zip.readAsTextAsync(zipEntries[24], exports.parseHTMLFile);

  var index = 0;

  // recursion so that we post the notes chronologically
  function parseZipEntry() {
    if (index < zipEntries.length) {
      parseHTMLFile(zip.readAsText(zipEntries[index]), function () {
        index++;
        parseZipEntry();
      });
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
  //createFBNote(title, message);
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
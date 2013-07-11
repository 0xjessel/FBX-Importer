var cheerio = require('cheerio')
  , graph   = require('fbgraph')
  , fs      = require('fs')
  , AdmZip  = require('adm-zip');

exports.processFile = function(path) {
  var zip = new AdmZip(path);
  var zipEntries = zip.getEntries();

//  zip.readAsTextAsync(zipEntries[24], exports.parseHTMLFile);

  zipEntries.forEach(function(zipEntry) {
    exports.parseHTMLFile(zip.readAsText(zipEntry));
  })
};

exports.parseHTMLFile = function(data) {
  var $ = cheerio.load(data);

  // filter out comment titles
  var titles = $('.blogheader').filter(function(i, elem) {
    return $(this).text().indexOf('Comments') === -1;
  }).toArray().reverse();

  $(titles).each(function(i, elem) {
    var title = $(this).text();
    var titleSibling = $(this).next();
    var commentTitle = titleSibling.next().next();

    var message = $(titleSibling).html();

    // add comments, if any
    if (commentTitle.length !== 0) {
      var comments = commentTitle.next();

      message += '<P>&nbsp;</P>';
      message += '<span style="text-decoration: underline; font-weight: bold">' +
        commentTitle.text() + '</span>';
      message += comments.html();
    }

    exports.createFBNote(title, message);
  });
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
var socket = io.connect();
var currentIndex = 0;
var totalFiles = 0;

// notify server we're ready to go
socket.emit('start processing');

// set the total counter
socket.on('init processing', function(data) {
  totalFiles = data.numFiles;
  currentIndex = data.currentIndex;

  setTotal(totalFiles);
  updateProgress();
  fadeInMetadata();
});

socket.on('resume processing', function(data) {
  totalFiles = data.numFiles;
  currentIndex = data.currentIndex;

  setTotal(totalFiles);
  updateProgress();
  fadeInMetadata();
});

// live update of the title of the note that was created
socket.on('create note', function(data) {
  var title = data.title
  var response = JSON.stringify(data.response);

  // update console
  var consoleDiv = $('.console');
  if (data.response.id === undefined) {
    consoleDiv.append(
      '<p>' + title + '<p/><p class="error_response">' + response + '</p>'
    );
  } else {
    consoleDiv.append(
      '<p>' + title + '<p/><p>' + response + '</p>'
    );
  }

  consoleDiv[0].scrollTop = consoleDiv[0].scrollHeight;
});

// increment progress bar and metadata
socket.on('file start', function(data) {
  var fileName = data.filename;
  currentIndex = data.currentIndex;

  $('#title').text(fileName);

  updateProgress();
});

socket.on('processing complete', function(data) {
  currentIndex = totalFiles;
  var success = data.notesCreated;
  var failures = data.notesFailed;

  updateProgress();

  // update console
  var consoleDiv = $('.console');
  consoleDiv.append('<p>========================</p>');
  consoleDiv.append('<p>archive.zip file deleted</p>');
  consoleDiv.append('<p>' + success + ' note(s) successfully created</p>');
  consoleDiv.append('<p>' + failures + ' note(s) failed to be created</p>');
  consoleDiv[0].scrollTop = consoleDiv[0].scrollHeight;

  $('#status_text').text('Import Completed!');
});

function updateProgress() {
  $('.bar').css('width', (currentIndex / totalFiles * 100) + '%');
  $('#current').text(currentIndex);
}

function setTotal(numFiles) {
  $('#total').text(numFiles);
}

function fadeInMetadata() {
  $('.metadata').removeClass('hidden_elem').hide().fadeIn(800);
}

$(document).ready(function() {
    $("#fb_share").click(function() {
      FB.ui({
        method: 'feed',
        link: 'http://fbximporter.jessechen.net/',
        picture: 'http://fbximporter.jessechen.net/img/cool.gif',
        name: 'FBX Importer',
        caption: 'Xanga -> FB',
        description: 'Import your Xanga blog posts into Facebook before Xanga shuts down!'
      }, function(response) {
        if (!response) {
          return;
        }

        if (typeof(response.post_id) === 'string') {
          $('.success').removeClass('hidden_elem').hide().fadeIn(800);
          $('#fb_share').off('click');
        }
      });
    });
});
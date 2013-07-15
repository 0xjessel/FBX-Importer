var socket = io.connect('http://xanga.meltedxice.c9.io');
var totalFiles = 0;
var success = 0;
var failures = 0;

// notify server we're ready to go
socket.emit('start processing');

// set the total counter
socket.on('init processing', function(data) {
  totalFiles = data.numFiles;
  $('#total').text(data.numFiles);
  $('.metadata').removeClass('hidden_elem').hide().fadeIn('slow');
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
    failures++;
  } else {
    consoleDiv.append(
      '<p>' + title + '<p/><p>' + response + '</p>'
    );
    success++;
  }

  consoleDiv[0].scrollTop = consoleDiv[0].scrollHeight;
});

socket.on('file start', function(data) {
  var fileName = data.filename;

  $('#title').text(fileName);
});

// increment progress bar and counter
socket.on('file complete', function() {
  // update progress bar
  var current = parseInt($('#current').text(), 10) + 1;
  $('.bar').css('width', (current / totalFiles * 100) + "%");

  // update numerator
  $('#current').text(current);
});

socket.on('processing complete', function() {
  // update console
  var consoleDiv = $('.console');
  consoleDiv.append('<p>========================</p>');
  consoleDiv.append('<p>archive.zip file deleted</p>');
  consoleDiv.append('<p>' + success + ' note(s) successfully created</p>');
  consoleDiv.append('<p>' + failures + ' note(s) failed to be created</p>');
  consoleDiv[0].scrollTop = consoleDiv[0].scrollHeight;
  
  $('#status_text').text('Import Completed!');
});
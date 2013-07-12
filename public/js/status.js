var socket = io.connect('http://xanga.meltedxice.c9.io');
var total = 0;
var counter = 0;

socket.emit('start processing');

// set the total counter
socket.on('init processing', function(data) {
  total = data.numFiles;
  $('#total').text(data.numFiles);
  $('.metadata').removeClass('hidden_elem').hide().fadeIn('slow');
});

// live update of the title of the note that was created
socket.on('create note', function(data) {
  var title = data.title
  var response = JSON.stringify(data.response);

  counter++;

  $('#title').text(title);

  var consoleDiv = $('.console');
  consoleDiv.append(
    '<p>' + title + '<p/><p>' + response + '</p>'
  );
  consoleDiv[0].scrollTop = consoleDiv[0].scrollHeight;
});

// increment progress bar and counter
socket.on('file complete', function() {
  var current = parseInt($('#current').text(), 10) + 1;
  $('.bar').css('width', (current / total * 100) + "%");

  $('#current').text(current);
});

socket.on('processing complete', function() {
  $('#statusText').text('Completed!');
});
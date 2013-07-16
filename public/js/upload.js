$(document).ready(function() {
  $('#confirm_dialog .submitBtn').click(function() {
    $('#confirm_dialog').modal('hide');
    $('form').submit();
  });
});
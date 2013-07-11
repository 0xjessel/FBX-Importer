/**
 * Module dependencies.
 */

var express   = require('express')
  , graph     = require('fbgraph')
  , app       = module.exports = express()
  , conf      = require('./conf.js')
  , util      = require('./util.js')
  , fs        = require('fs');


// Configuration

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.use(express.errorHandler());
});

// Routes

app.get('/', function(req, res){
  res.render("index", { title: "FBX" });
});

app.get('/auth/facebook', function(req, res) {
  // we don't have a code yet
  // so we'll redirect to the oauth dialog
  if (!req.query.code) {
    var authUrl = graph.getOauthUrl({
        "client_id":     conf.fb.client_id
      , "redirect_uri":  conf.fb.redirect_uri
      , "scope":         conf.fb.scope
    });

    if (!req.query.error) { //checks whether a user denied the app facebook login/permissions
      res.redirect(authUrl);
    } else {  //req.query.error == 'access_denied'
      res.send('access denied');
    }
    return;
  }

  // code is set
  // we'll send that and get the access token
  graph.authorize({
      "client_id":      conf.fb.client_id
    , "redirect_uri":   conf.fb.redirect_uri
    , "client_secret":  conf.fb.client_secret
    , "code":           req.query.code
  }, function (err, facebookRes) {
    res.redirect('/upload');
  });


});

// user gets sent here after being authorized
app.get('/upload', function(req, res) {
  util.getPrivacySetting(function(privacyString) {
    res.render(
      "upload",
      { title: "Upload ZIP File", privacyString: privacyString, errors: {}}
    );
  });
});

// user gets sent here after uploading a zip file
app.post('/processing', function(req, res) {
  var file = req.files.archive;

  // not sure if this is necessary..but better safe than sorry
  fs.chmod(file.path, '600');

  var errors = util.validateFile(file);

  if (errors.length === 0) {
    util.processFile(file.path);
    res.redirect("/");
  } else {
    util.getPrivacySetting(function(privacyString) {
      res.render(
        "upload",
        { title: "Upload ZIP File", privacyString: privacyString, errors: errors }
      );
    });

    // delete the files
    fs.unlink(file.path);
  }
});


var port = process.env.PORT || 3000;
app.listen(port, function() {
  console.log("Express server listening on port %d", port);
});
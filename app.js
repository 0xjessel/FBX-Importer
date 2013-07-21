/**
 * Module dependencies.
 */
var cluster = require('cluster');

// Code to run if we're in the master process
if (cluster.isMaster) {
  // Count the machine's CPUs
  var cpuCount = require('os').cpus().length;

  // Create a worker for each CPU
  for (var i = 0; i < cpuCount; i += 1) {
      cluster.fork();
  }
// Code to run if we're in a worker process
} else {
  var express        = require('express')
    , connect        = require('connect')
    , RedisStore     = require('connect-redis')(express)
    , ioRedisStore   = require('socket.io/lib/stores/redis')
    , ioRedis        = require('socket.io/node_modules/redis')
    , cookie         = require('cookie')
    , http           = require('http')
    , graph          = require('fbgraph')
    , app            = express()
    , server         = http.createServer(app)
    , util           = require('./util.js')
    , fs             = require('fs')
    , io             = exports.io = require('socket.io').listen(server)
  ;

  var pub, sub, client;

  // redis config
  var redis;
  if (process.env.REDISTOGO_URL) { // heroku
    var rtg   = require('url').parse(process.env.REDISTOGO_URL);
    redis = ioRedis.createClient(rtg.port, rtg.hostname);
    redis.auth(rtg.auth.split(':')[1]);

    pub = ioRedis.createClient(rtg.port, rtg.hostname);
    pub.auth(rtg.auth.split(':')[1]);

    sub = ioRedis.createClient(rtg.port, rtg.hostname);
    sub.auth(rtg.auth.split(':')[1]);

    client = ioRedis.createClient(rtg.port, rtg.hostname);
    client.auth(rtg.auth.split(':')[1]);
  } else { // localhost
    redis = ioRedis.createClient(16379, '127.7.255.129');

    pub = ioRedis.createClient(16379, '127.7.255.129');
    sub = ioRedis.createClient(16379, '127.7.255.129');
    client = ioRedis.createClient(16379, '127.7.255.129');
  }

  redis.on('ready', function() {
    console.log('info: connected to redis');
  });

  redis.on("error", function (err) {
    console.log("Redis Error " + err);
  });

  // session config
  var SECRET = process.env.CLIENT_SECRET || 'xanga';
  var sessionStore = new RedisStore({ client: redis });
  var ioSessionStore = new ioRedisStore({ redis: ioRedis, redisPub: pub, redisSub: sub, redisClient: redis });
  var mixpanel = exports.mixpanel = require('mixpanel').init(process.env.MIXPANEL || '555');
  // map of session id to a variety of data related to a session
  var SESSIONID_DATA_MAP = exports.SESSIONID_DATA_MAP = {};

  // Configuration

  app.configure(function() {
    app.use(express.cookieParser(SECRET));
    app.use(express.session({
      store: sessionStore
    , secret: SECRET
    }));
    app.set('views', __dirname + '/views');
    app.set('view engine', 'jade');
    app.use(express.bodyParser());
    app.use(express.methodOverride());
    app.use(app.router);
    app.use(express.static(__dirname + '/public'));
    app.use(express.favicon(__dirname + '/public/img/favicon.ico'));
  });

  var conf;
  app.configure('development', function() {
    conf = require('./conf.js');
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
  });

  app.configure('production', function() {
    app.use(express.errorHandler());
  });

  // Routes

  app.get('/', function(req, res) {
    mixpanel.track('Home Page Loaded');
    res.render('index', { title: 'FBX Importer' });
  });

  app.get('/auth/facebook', function(req, res) {
    // we don't have a code yet
    // so we'll redirect to the oauth dialog
    if (!req.query.code) {
      var authUrl = graph.getOauthUrl({
          'client_id':     process.env.CLIENT_ID || conf.client_id
        , 'redirect_uri':  process.env.REDIRECT_URI || conf.redirect_uri
        , 'scope':         process.env.SCOPE || conf.scope
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
        'client_id':     process.env.CLIENT_ID || conf.client_id
      , 'redirect_uri':  process.env.REDIRECT_URI || conf.redirect_uri
      , 'client_secret': process.env.CLIENT_SECRET || conf.client_secret
      , 'scope':         process.env.SCOPE || conf.scope
      , 'code':          req.query.code
    }, function (err, facebookRes) {
      req.session.access_token = facebookRes.access_token;
      res.redirect('/upload');
    });
  });

  // user gets sent here after being authorized
  app.get('/upload', function(req, res) {
    if (!req.session.access_token) {
      res.redirect('/');
      return;
    }

    mixpanel.track('Upload Page Loaded');
    graph
      .setAccessToken(req.session.access_token)
      .get('me?fields=id', function (err, res) {
      mixpanel.people.set(res.id, {
        $created: (new Date().toISOString()),
        name: res.id,
        notes_created: 0,
        notes_failed: 0,
      });
    });

    util.getPrivacySetting(req.session.access_token, function(name, privacyString) {
      res.render(
        'upload',
        {
          title: 'Upload ZIP File',
          name: name,
          privacyString: privacyString,
          errors: {}
        }
      );
    });
  });

  // user gets sent here after uploading a zip file
  app.post('/processing', function(req, res) {
    mixpanel.track('Zip File Uploaded');
    var file = req.files.archive;

    // not sure if this is necessary..but better safe than sorry
    fs.chmod(file.path, '600');

    var errors = util.validateRequest(req.sessionID, file);

    if (errors.length === 0) {
      SESSIONID_DATA_MAP[req.sessionID] = {
        filepath: file.path,
        notes_created: 0,
        notes_failed: 0,
        num_files: 0,
        started: false,
        access_token: req.session.access_token
      };
      res.redirect('/status');
      return;
    } else {
      util.getPrivacySetting(req.session.access_token, function(name, privacyString) {
        res.render(
          'upload',
          {
            title: 'Upload ZIP File',
            name: name,
            privacyString: privacyString,
            errors: errors
          }
        );
      });

      // delete the files
      fs.unlink(file.path);
    }
  });

  app.get('/status', function(req, res) {
    var sessionData = SESSIONID_DATA_MAP[req.sessionID];
    
    if (!sessionData) {
      res.redirect('/');
      return;
    }

    mixpanel.track('Status Page Loaded');

    res.render(
      'status',
      { title: 'Import Status' }
    );
  });

  app.get('/faq', function(req, res) {
    res.render('faq', { title: 'FAQ', isFAQ: true });
  });

  io.configure(function() {
    io.set('store', ioSessionStore);
    io.set("transports", ["xhr-polling"]);
    io.set("polling duration", 10);
  });

  io.set('authorization', function(data, accept) {
    if (!data.headers.cookie) {
      return accept('Session cookie required.', false);
    }

    var _signed_cookie = cookie.parse(data.headers.cookie);
    data.sessionID = connect.utils.parseSignedCookie(_signed_cookie['connect.sid'], SECRET);

    sessionStore.get(data.sessionID, function(err, session) {
      if (err) {
        return accept('Error in session store.', false);
      } else if (!session) {
        return accept('Session not found.', false);
      }

      data.session = session;
      return accept(null, true);
    });
  });

  io.set('log level', 1);

  io.sockets.on('connection', function(socket) {
    var sessionID = socket.handshake.sessionID;
    socket.join(sessionID);

    socket.on('start processing', function() {
      try {
        util.processFile(sessionID);
      } catch (e) {
        console.log('exception while processing file ' + e);
        console.trace();

        fs.unlink(SESSIONID_DATA_MAP[sessionID].filepath);
        delete SESSIONID_DATA_MAP[sessionID];
      }
    });
  });

  var port = process.env.PORT || 3000;
  server.listen(port, function() {
    console.log(
      'Express server listening on port %d running on Worker %d',
      port,
      cluster.worker.id
    );
  });
}
'use strict';

var PORT               = 2012,
    express            = require('express'),
    crypto             = require('crypto'),
    hostname           = require('os').hostname(),
    colors             = require('colors'),
    path               = require('path'),
    app                = express(),
    server             = require('http').createServer(app),
    io                 = require('socket.io').listen(server),
    pg                 = require('pg'),
    listening          = {},
    _                  = require('underscore'),
    homeFolder, port, pgConnectionString;

/**
 * Constructor
 */
function NotifyIt( port ) {
  initEnvironment( port );
  initRouting();
  initSocketIO();

  /**
   * Setting up environment
   */
  function initEnvironment( serverPort ) {
    homeFolder = __dirname;
    console.log('   info  -'.cyan, 'NotifyIt root'.yellow, homeFolder);

    // express config
    app.set('view engine', 'ejs');
    app.set('views', homeFolder + '/views');
    app.set('views');
    app.set('view options', { layout: null });

    app.use (function(req, res, next) {
        var data='';
        req.setEncoding('utf8');
        req.on('data', function(chunk) {
           data += chunk;
        });

        req.on('end', function() {
            req.body = data;
            next();
        });
    });

    // static resources
    app.use('/js', express.static(homeFolder + '/js'));
    app.use('/css', express.static(homeFolder + '/css'));
    app.use('/images', express.static(homeFolder + '/images'));

    // port
    port = serverPort || parseInt(process.argv[2], 10) || PORT;

    pgConnectionString = process.env.POSTGRES_CONNECTION_STRING;
    if (!pgConnectionString){
      console.log("No Postgres connection string evironment variable found.".yellow);
      console.log("Disabling Postgres PUB/SUB support!".red);
    }

  }

  /**
   * Init service routing
   */
  function initRouting() {
    /** Index page. */
    app.get('/', function(request, response) {
      response.render('index', { host: hostname, port: port });
    });

    /** Post new result */
    app.post('/pub/:channel/:eventName', routePubRequest );
  }

  /**
   * Handle HTTP request to publish data
   */
  function routePubRequest(request, response) {
    var data      = request.body,
        channel   = request.params.channel,
        eventName = request.params.eventName,
        obj;

    if(request.is('json')) {
      try {
        obj = JSON.parse(data);
      } catch(e) {
        response.send('Malformed JSON', 500);
      }
    } else {
      obj = data;
    }

    if(obj) {
      publish( channel, eventName, obj );
    }

    response.send(200);
  }

  /**
   * Publish data to listeners
   */
  function publish( channel, eventName, obj ) {
    var evt     = channel + ':' + eventName,
        wrapper = {
          channel:   channel,
          eventName: eventName,
          data:      obj
        };

    console.log('   info -'.cyan, 'publishing event'.white, evt.yellow, 'with data'.white, obj.toString().yellow);
    io.sockets.emit(evt, wrapper);
    io.sockets.emit('all', wrapper);
  }


  /**
   * Postgres PUB/SUB initialization
   */
  function initPostgresPubSub(socket) {
    socket.on('subscribe', function(channel) {
      socket.join(channel);
      console.log("New socket joined...");
      if (!listening.hasOwnProperty(channel)) {
        // only create new connection and new listeners for new
        // channels
        var client = new pg.Client(pgConnectionString);
        client.connect();
        client.query('LISTEN "'+channel+'"');
        listening[channel] = client;
        client.on('notification', function(data) {
          try {
            var obj = JSON.parse(data.payload);
            io.sockets.in(channel).emit('notification', obj);
          } catch(e) {
            console.log(e);
            console.log(data.payload);
          }
        });
      }
    });
  }

  function cleanupAfterSocketLeave(room){
    // we need to block here, and wait for the client to actually leave the room
    process.nextTick(function(){
        // remove leading slash
        room = room.split('/')[1];
        var cnt = io.sockets.clients(room).lenth;
        if (!cnt) {
            console.log('Unsubscribing from Postgres channel: ' + room);
            var client = listening[room];
            client.end();
            delete listening[room];
        }
    });
  }

  /**
   * Socket io initialization
   */

  function initSocketIO() {
    io.set('log level', 1);

    io.sockets.on('connection', function(socket) {
      if (pgConnectionString) {
        initPostgresPubSub(socket);
      } else {
        socket.emit('connected');
      }

      socket.on('disconnect', function() {
        console.log('Browser Disconcerting!');
        var rooms = io.sockets.manager.roomClients[socket.id];
        for(var room in rooms) {
          if (room){
            socket.leave(room, cleanupAfterSocketLeave(room));
          }
        }
      }); // end callback function

    });

  }

  /**
   * Start server
   */
  function start() {
    server.listen(port);
    console.log('NotifyIt started on'.yellow, (hostname + ':' + port).cyan);
  }

  /**
   * Stop server
   */
  function stop() {
    server.close();
    console.log('NotifyIt shutting down'.yellow);
  }

  return {
    start: start,
    stop: stop
  };
}

module.exports = NotifyIt;

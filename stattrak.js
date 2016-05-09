//TODO: Redundanz einfügen (try/ catch)
//TODO: chart.js
mdb = require('mongodb').MongoClient;
assert = require('assert');
http = require('http');
fs = require('fs');
async = require('async');
ObjectId = require('mongodb').ObjectID;
dispatcher = require("httpdispatcher");
serialport = require('serialport');
chalk = require('chalk');

const port = 3000;
const host = '0.0.0.0';
SerialPort = serialport.SerialPort;
arduinoPort = process.argv[2];

var printLog = true;
var playerMatchKills = 0;
var playerTotalKills;
var roundLive = false;
var prevPayload;
var portOpen;
var matchId;

var socketListeners = [];

const DEBUG = true;

//mit mongodb-datenbank verbinden
var url = 'mongodb://localhost:27017/csgo';
mdb.connect(url, function(err, db) {
  assert.equal(null, err);
  console.log("Connected correctly to database " + url);
  db.close();
});

//open port
try {
  var myPort = new SerialPort(arduinoPort, {
    baudrate: 9600
  });
  parser: serialport.parsers.raw //rohdatenparser definieren
  serialport.on('open', function() {
    console.log('Serial Port Opened');
    portOpen = true;
    serialport.on('data', function(data) {
      console.log(data[0]);

    });
  });
} catch (err) {
  console.log("Nicht mit Arduino verbunden");
  portOpen = false;
}

//implementation of abstract port functions
if (portOpen) {
  myPort.on('open', showPortOpen);
  myPort.on('data', sendSerialData);
  myPort.on('close', showPortClose);
  myPort.on('error', showError);

  function showPortOpen() {
    console.log('port open. Data rate: ' + myPort.options.baudRate);
  }

  function sendSerialData(data) {
    console.log(data[0]);
    if (typeof data[1] !== 'undefined') console.log(data[1]);
  }

  function showPortClose() {
    console.log('port closed.');
  }

  function showError(error) {
    console.log('Serial port error: ' + error);
  }
}

/*--------------------------MONGODB-FUNKTIONEN----------------------------------*/

//funktion payload in db einfügen
var insertPayload = function(db, pl, callback) {
  db.collection(pl.player.steamid).insertOne(pl, function(err, result) {
    assert.equal(err, null);
    //collection ist die steamid des spielers
    console.log(pl);
    console.log("Payload in Collection " + pl.player.steamid + " eingefügt.");
    callback(result);
  });
}

//letztes match einer SteamId auslesen und matchId zurückgeben
var queryLastMatch = function(db, id, callbackMain) {
  //Collectionname: match/STEAMID
  matchCollection = 'match/' + id;

  async.waterfall([
    async.apply(countMatches, matchCollection, db),
    getAllMatches,
    getMatchId
  ], function(err, lastMatch, lastPayload) {
    console.log(chalk.cyan("queryLastMatch() Callback beendet, letztes Match:"));
    console.dir(lastMatch);
    console.log(chalk.cyan("Letzte Payload:"));
    console.log(chalk.blue(lastPayload));
    callbackMain(lastMatch, lastPayload);
  });

  function countMatches(matchCollection, db, callback) {
    console.log(chalk.yellow("Funktion: countMatches()"));
    //checken ob matchcollection vorhanden ist
    db.collection(matchCollection).count(function(err, result) {
      assert.equal(err, null);
      console.log(chalk.blue("Größe der Matchcollection: " + result));
      callback(null, matchCollection, result, db);
    });
  }

  function getAllMatches(matchCollection, matchCollectionSize, db, callback) {
    //wenn collection vorhanden, alle matches der matchcollection in array zurückgeben
    console.log(chalk.yellow("Funktion: getAllMatches()"));
    if (matchCollectionSize > 0) {
      db.collection(matchCollection).find({}).toArray(function(err, matches) {
        assert.equal(err, null);
        console.log(chalk.blue("Gefundene Matches: " + matches.length));
        callback(null, db, matches, matchCollectionSize);
      });
    } else {
      //wenn collection leer, null zurückgeben
      callback(null, db, null, matchCollectionSize)
    }
  }

  function getMatchId(db, matches, matchCollectionSize, callback) {
    //letztes match finden
    console.log(chalk.yellow("getMatchId()"));
    var lastPayload = null;

    if (matchCollectionSize > 0) {
      var lastMatchId = 0;
      var lastMatchIndex = 0;
      var lastMatchRound = 0;
      var lastMatchTicks = 0;
      //größte matchid finden
      for (var i = 0; i < matches.length; i++) {
        if (matches[i].matchid > lastMatchId) {
          lastMatchId = matches[i].matchid;
          lastMatchIndex = i;
          lastMatchRound = matches[i].rounds;
          lastMatchTicks = matches[i].ticks;
          //console.dir(chalk.cyan(matches[i]));
        }
      }
      console.log(chalk.blue("Letztes Match: " + lastMatchId + ", Runde: " + lastMatchRound + ", Ticks: " + lastMatchTicks));
      //letzten tick suchen
      var tickCollection = "ticks/" + id + "/" + lastMatchId;

      db.collection(tickCollection).findOne({
        tickid: lastMatchTicks
      }, function(err, res) {
        assert.equal(null, err);
        lastPayload = res;

        //return match, tick
        callback(null, matches[lastMatchIndex], lastPayload);
      });
    } else {
      console.log(chalk.blue("Kein letztes Match"));
      //return match, tick
      callback(null, null, lastPayload);
    }
  }
}

//letzte ticks zurückgeben TODO
var queryNewTick = function(db, login, clientLastTick, callback) {
  //letztes match erhalten
  queryLastMatch(db, login, function(mId, rounds) {
    //collection von letztem match erhalten
    var tickCol = "ticks/" + login + "/" + mId;
    //alle einträgere mit höhere tickId finden
    var newTicks = db.products.find({
      matchid: {
        $gt: clientLastTick
      }
    });
    callback(mId, newTicks);
  });
}

//payload einfügen, bei bedarf neue collection erstellen
var queryInsertPayload = function(db, pl, lastMatchId, newMatch, callbackMain) {
  console.log("QueryInsertPayload, Neue Payload in Datenbank einfügen");
  if (newMatch) {
    //neue matchid
    matchId = lastMatchId + 1;
    //neue tickid an pl anfügen
    pl.tickid = 1;
    //collectionname: ticks/STEAMID/MATCHID
    var collection = 'ticks/' + pl.player.steamid + '/' + matchId;
    console.log("Neue tickcollection wird erstellt, Collection: " + collection);
    //neue tickcollection erstellen
    async.waterfall([
      async.apply(createColl, db, pl, collection, matchId),
      insertPl,
      createMatch,
    ], function(err, res) {
      console.log("queryInsertPayload callback: ");
      console.dir(res);
      callbackMain(res);
    });

    //neue tickcollection anlegen
    function createColl(db, pl, collection, matchId, callback) {
      db.createCollection(collection, function(err, res) {
        assert.equal(null, err);
        console.log("Neue Tickcollection erstellt, Id: " + matchId);
        //console.log(collection);
        callback(null, db, pl, collection, matchId);
      });
    }

    //payload in neue tickcollection einfügen
    function insertPl(db, pl, collection, matchId, callback) {
      console.log(chalk.yellow("Function: " + "insertPL"));
      console.log(chalk.blue("Collection: " + collection));
      //erste payload anhängen
      db.collection(collection).insertOne(pl, function(err, res) {
        assert.equal(err, null);
        console.log("Tick eingefügt, TickId: " + pl.tickid);
        callback(null, db, pl, matchId);
      });
    }

    //neues match in matchcollection einfügen
    function createMatch(db, pl, matchId, callback) {
      console.log("Neues Match in Matchcollection einfügen");
      console.log("MatchId: " + matchId);
      var matchCollection = "match/" + pl.player.steamid;
      db.collection(matchCollection).insertOne({
        //matches werden hier definiert
        matchid: matchId,
        startTime: 0,
        endTime: 0,
        ticks: 0,
        gameMode: pl['map']['mode'],
        matchStats: {},
        rounds: pl['map']['round'],
        map: pl['map']['name']
      }, function(err, result) {
        assert.equal(err, null);
        console.log("Neues Match erstellt, Id: " + matchId);
        callback(null, matchId);
      });
    }
  } else {
    var matchId = lastMatchId;
    //collectionname: ticks/STEAMID/MATCHID
    var tickCol = 'ticks/' + pl.player.steamid + '/' + matchId;
    console.log("Payload wird angefügt, Collection: " + tickCol);

    async.waterfall([
      async.apply(queryLastTick, db, pl, tickCol),
      insertPayloadAfterTick
    ], function(err, result) {
      callbackMain(matchId);
    });

    function queryLastTick(db, pl, tickCol, callback) {
      //letzte tickid erhalten
      db.collection(tickCol).findOne({
        $query: {},
        $orderby: {
          $natural: -1
        }
      }, function(err, lastTick) {
        assert.equal(err, null);
        var lastTickId = lastTick.tickid;
        //tickId inkrementieren und anfügen
        lastTickId++;
        pl.tickid = lastTickId;
        console.log("Letzten Tick gefunden, neue TickId: " + pl.tickid);
        callback(null, db, pl, tickCol);
      });
    }

    function insertPayloadAfterTick(db, pl, tickCol, callback) {
      //payload einfügen
      db.collection(tickCol).insertOne(pl, function(err, res) {
        assert.equal(err, null);
        callback(matchId);
      });
    }
  }
}

//db query
var queryAllData = function(db, userid, callback) {
  var collection = db.collection(String(userid));
  var cursor = collection.find();
  cursor.each(function(err, doc) {
    assert.equal(err, null);
    if (doc != null) {
      console.dir(doc);
    } else {
      callback();
    }
  });
};

//db login query
var queryUser = function(db, userid, callback) {
  var collection = db.collection("User"); //zu collection user verbinden
  //wenn user gefunden den user returnen, ansonsten user einfügen
  collection.findAndModify({
    "steamid": String(userid)
  }, [], {
    "$setOnInsert": {
      "steamid": String(userid),
      "totalStats": {},
      "currNick": "",
      "Matches": 0
    }
  }, {
    "upsert": true
  }, {
    "new": true
  }, function(err, doc) {
    assert.equal(err, null);
    if (doc.value != null) {
      console.dir(doc);
      console.log("User eingeloggt. SteamID: " + doc.value['steamid'] + ", Nick: " + doc.value.currNick);
      //console.dir(doc);
      //id und nick an xmlhttp request zurücksenden
      callback(doc.value['steamid'], doc.value.currNick);
    } else {
      console.log("Neuer User registriert, Steamid: " + userid);
      callback(userid, null);
    }
  });
};

//cookies auslesen
function parseCookies(request) {
  var list = {},
    rc = request.headers.cookie;

  rc && rc.split(';').forEach(function(cookie) {
    var parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURI(parts.join('='));
  });

  return list;
}

//funktion killcount an display senden
var sendKillCount = function(kc) {
  if (portOpen) {
    var kcArray = (kc).toString(10).split("").map(function(t) {
      return parseInt(t)
    }); //make killCount an Array
    var kcBuffer = new Buffer(kcArray);

    myPort.write(kcBuffer, function(err, result) {
      if (err != null) console.log(err);
      if (result != null) console.log(result);
    });
  }
}

//anahnd von der neuen und der letzten payload überprüfen, ob sie beide im selben match liegen
var differentMatchCheck = function(oldPayload, newPayload) {
    console.log(chalk.yellow("Funktion: differentMatchCheck()"));
    //auf unterschiedliche map checken
    if(oldPayload.map['name'] != newPayload.map['name']) {
      console.log(chalk.blue("Andere Map, unterschiedliche Runde"));
      return true;
    }
    var differentMatch;
    //alle rundenzeiten [minimal maximal]
    var freezetime = [0, 15];
    var live = [0, 155];
    var over = [0, 10];

    //arrays benennen
    freezetime.name = "freezetime";
    live.name = "live";
    over.name = "over";

    //rundenablauf als array
    var roundPhases = [freezetime, live, over];

    //zeiten und zeitunterschiede der payloads
    var oldTime = oldPayload.provider.timestamp;
    var newTime = newPayload.provider.timestamp;

    var timeDelta = newTime - oldTime;

    //minimale und maximale legaler zeitraum
    var minTime = 0;
    var maxTime = 0;

    //phasen der payloads
    var oldPhaseIndex = null;
    var newPhaseIndex =  null;

    //index der phase im array abspeichern
    roundPhases.forEach(function(element, index, array) {
      if(element.name == newPayload.round.phase) {
        oldPhaseIndex = index;
      }
      if(element.name == newPayload.round.phase) {
        newPhaseIndex = index;
      }
    });

    //runden und und rundenunterschied der payloads
    var oldRound = oldPayload.map.round;
    var newRound = newPayload.map.round;

    var roundDelta = newRound - oldRound;

    //minimalen und maximalen legalen zeitabstand bestimmen

    //wenn gleiche runde
    if (roundDelta == 0) {
      //wenn neuere Phase gleich oder höher
      console.log("Gleiche Runde");
      if (newPhaseIndex >= oldPhaseIndex) {
        //alle phasen bis zur neuen phase iterieren
        for (var i = oldPhaseIndex; i <= newPhaseIndex; i++) {
          console.log("Gleiche oder höhere Phase");
          //minimalen zeitabstand errechnen
          minTime += roundPhases[i][0];
          //maximalen zeitabstand errechnen
          maxTime += roundPhases[i][1];
        }
        //minimaler zeitabstand
      } else {
        //neue phase geringer als alte, ergo neues match
        console.log(chalk.blue("Geringe Phase, neues Match"));
        return true;
      }
    }
    //wenn spätere runde
    else if (roundDelta > 0) {
      console.log("Spätere Runde");
      var roundIterator = oldRound;
      var phaseIterator = oldPhaseIndex;

      //durch alle runden samt phasen bis zur neuen payload iterieren
      while (roundIterator <= newRound) {
        //wenn letzte runde noch nicht erreicht wurde, ganze runden iterieren
        if (roundIterator != newRound) {
          while (phaseIterator < roundPhases.length) {
            //minimalen zeitabstand errechnen
            minTime += roundPhases[phaseIterator][0];
            //maximalen zeitabstand errechnen
            maxTime += roundPhases[phaseIterator][1];
            //nächste rundenphase
            phaseIterator++;
          }
          //auf erste rundenphase setzen
          phaseIterator = 0;
        } else {
          //wenn letzte runde erreicht, bis zur letzten Phase iterieren
          while (phaseIterator <= newPhaseIndex) {
            //minimalen zeitabstand errechnen
            minTime += roundPhases[phaseIterator][0];
            //maximalen zeitabstand errechnen
            maxTime += roundPhases[phaseIterator][1];
            //nächste rundenphase
            phaseIterator++;
          }
        }
        roundIterator++;
      }
    } else {
      //neue runde geringer als alte, ergo neues match
      console.log(chalk.blue("Neue Runde geringer als alte, unterschiedliches Match"));
      return true;
    }
    //aktuellen zeitabstand mit legalem zeitabstand vergleichen
    if (timeDelta <= maxTime && timeDelta >= minTime) {
      differentMatch = false;
    } else {
      differentMatch = true;
    }

    console.log(chalk.blue("Maximaler Zeitunterschied: " + maxTime + ", minimaler Zeitunterschied: " + minTime));
    console.log(chalk.blue("Gemessener Zeitunterschied: " + timeDelta));
    console.log(chalk.blue("Unterschiedliches Match: " + differentMatch));

    return differentMatch;
  }
  /*-----------------------------------------------------------------------*/

//nach connecten mit arduino killcount übermitteln
if (portOpen) {
  myPort.on("open", function() {
    console.log('open');
    if (playerTotalKills != null) sendKillCount(playerTotalKills);
  });
}
console.log("Killcount lesen");

playerTotalKills = parseInt(fs.readFileSync("killcount.txt"));

console.log("Killcount beim Initieren: " + playerTotalKills);

//http dispatcher callback-funktion
var handleRequest = function(req, res) {
  {
    //dispatcher einrichten
    try {
      console.log(req.url);
      dispatcher.dispatch(req, res);
    } catch (err) {
      console.log(err);
    }
    //relativen ressourcenpfad setzen
    dispatcher.setStatic('resources');
    dispatcher.setStaticDirname('.');

    /*-----------------------CS-DATEN EMPFANGEN--------------------------------------------------*/
    dispatcher.onPost("/", function(req, res) {
      console.log(chalk.bgWhite("Empfange CS-Tick..."));

      var payload;
      var body = "";

      req.setEncoding('utf8');

      //daten einlesen
      /*req.on('data', function(data) {
          res.sendStatus(200);
          body += data;
          console.log(chalk.blue("daten angenommen!"));
        });
        req.on('end', function() {
          console.log(chalk.blue("end gesendet!"));
          //daten annehmen OK (200) an gameclient senden
            res.writeHead(200, {
              'Content-Type': 'text/html'
            });
      res.end('');
    });*/

      //OK (200) an gameclient senden
      res.writeHead(200, {
        'Content-Type': 'text/html'
      });
      res.end('');

      //daten aus dem spiel in json parsen
      try {
        payload = JSON.parse(req.body); //payload als objekt einlesen
      } catch (err) {
        console.log(err)
      }

      //checken, ob objekt definiert ist, um fehler zu vermeiden
      if (typeof payload.player !== 'undefined' && typeof payload['round'] !== 'undefined') {
          //TODO checken, ob mm oder casual läuft (payload.map.mode)nsole.log(payload.player.activity)
        console.log("Player wird authentifiziert...");
        //checken, ob der aktuelle spieler mit der providerid übereinstimmt (um spectator zu ignorieren)
        if (payload.provider.steamid == payload.player.steamid) {
          console.log(chalk.green("Player " + payload.player.name + ", SteamID: " + payload.player.steamid + " authentifiziert."));

          //TODO checken, ob mm oder casual läuft (payload.map.mode)
          console.log(payload.player.activity)

          //checken, ob runde läuft oder grade vorbei ist (freezetime wird ignoriert)
          if (payload['round'].phase == 'live' || payload['round'].phase == 'over') {
            roundLive = true;
          } else {
            roundLive = false;
          }

          //checken, ob match läuft oder vorbei ist (Warmup wird ignoriert)
          if (payload.map.phase == 'live') {
            matchLive = true;
          } else {
            matchLive = false;
          }

          /*----------------------------------------MONGODB-BLOCK------------------------------------------------------*/
          try {
            //TODO menücheck
            if (matchLive) {
              console.log(chalk.green("Match live!"));

              //wenn user an websocket verbunden, payload senden
              if (socketListeners.indexOf(payload.player.steamid) > -1) {
                sendTick(payload);
              }

              mdb.connect(url, function(err, db) {
                assert.equal(err, null);

                //Timestamp an payload anfügen
                var time = Date.now();

                //letztes match und letzte payload abrufen, matchcollection und erstes match erstellen falls nicht vorhanden
                queryLastMatch(db, payload.player.steamid, function(lastMatch, lastPayload) {
                  async.waterfall([
                    async.apply(checkRoundDelta, db, payload, lastMatch, lastPayload),
                    getMatch,
                    updateMatch,
                  ], function(err, res) {
                    //verbindung zu db beenden
                    console.log("Aktualisierungen beendet, Verbindung zu DB wird geschlossen");
                    db.close();
                  });

                  //anhand von rundendifferenz prüfen, ob neues match stattfindet
                  //TODO matchüberprüfung anhand von runden-/mapdifferenz, time
                  function checkRoundDelta(db, payload, lastMatch, lastPayload, callback) {
                    //wenn allererste runde, match 1 erstellen
                    if (lastMatch == null || lastPayload == null) {
                      console.log(chalk.cyan("Keine Matchdaten oder Payloads vorhanden, erstelle neues Match"));
                      queryInsertPayload(db, payload, 0, true, function(newMId) {
                        callback(null, newMId, payload);
                      });
                    } else {
                      //nach neuem match prüfen
                      var newMatch = differentMatchCheck(lastPayload, payload);
                      //payload einfügen und mit differentMatchCheck matchunterschiede bestimmen
                      queryInsertPayload(db, payload, lastMatch.matchid, newMatch, function(newMId) {
                        callback(null, newMId, payload);
                      });
                    }
                  }

                  //match laden
                  function getMatch(MId, payload, callback) {
                    var matchCol = 'match/' + payload.player.steamid;
                    db.collection(matchCol).findOne({
                      matchid: MId
                    }, function(err, res) {
                      assert.equal(err, null);
                      callback(null, payload, res, matchCol);
                    });
                  }
                  //Matchinfo aktualisieren
                  function updateMatch(payload, match, matchCol, callback) {
                    //TODO mehr informationen updaten
                    console.log(chalk.yellow("updateMatch()"));
                    //start-und endzeitpunkt, dauer
                    if (match.startTime == 0) {
                      match.startTime = payload.provider.timestamp;
                    }
                    match.endTime = payload.provider.timestamp;
                    match.duration = match.endTime - match.startTime;

                    console.log(chalk.blue("Matchdauer: " + match.duration));

                    //gesammelte ticks
                    match.ticks = payload.tickid;

                    //map in match einfügen
                    if (match.map == '') {
                      match.map = payload.map['name'];
                    }
                    //gamemode in match einfügen
                    if(match.gamemode == '') {
                      match.gameMode = payload.map.mode;
                    }
                    //runden updaten
                    match.rounds = payload['map']['round'];


                    console.log(chalk.green("Aktuelles Match:"));
                    console.dir(match);
                    //nach allen updates die alte matchinfo durch neue ersetzen
                    db.collection(matchCol).update({
                      matchid: match.matchid
                    }, match, function(err, result) {
                      assert.equal(err, null);
                      callback();
                    });
                  }

                });
              });

              console.dir(payload);
              console.log("Round Live: " + roundLive);
            } else {
              console.log(chalk.red("Match nicht live!"));
            }



            /*----------------------------------------ARDUINO-BLOCK-----------------------------------------------------*/

            //zuletzt erhaltene match_kills in eine variable setzen
            currMatchKills = payload.player['match_stats'].kills;

            //playerTotalKills aktualisieren
            playerTotalKills = parseInt(fs.readFileSync("killcount.txt"));
            console.log("Aktuelle PlayerTotalKills: " + playerTotalKills);

            //playerMatchKills aktualisieren, wenn Runde läuft und neuer Wert ungleich ist
            if (matchLive && playerMatchKills != currMatchKills) {
              var deltaMatchKills = currMatchKills - playerMatchKills; //errechne die differenz zwischen alten und neuen daten
              playerMatchKills = currMatchKills; //neue daten altern lassen
              playerTotalKills = playerTotalKills + deltaMatchKills; //playerTotalKills aktualisieren

              //neuen Killcount speichern wenn änderung vorliegt
              console.log("Kills werden gespeichert...");
              if (deltaMatchKills != 0) {

                try {
                  var data = fs.writeFileSync('killcount.txt', playerTotalKills);
                  console.log("Killcount gespeichert");
                  sendKillCount(playerTotalKills);
                } catch (e) {
                  console.log("speichern fehlgeschlagen!");
                }
              }

              console.log("Player Round Kills: " + playerMatchKills);
              console.log("Player Total Kills: " + playerTotalKills);
            } else if (!matchLive) {
              playerMatchKills = 0;
            } //playerMatchKills am Ende jedes Matches zurücksetzen
          } catch (err) {
            console.log(err);
          }
        } else {
          console.log(chalk.red("Player nicht erkannt!"));
        }
      }
      //payload altern lassen
      prevPayload = payload;
    });
    /*-------------------------WEBSITE-------------------*/
    dispatcher.onGet("/", function(req, res) {
      res.writeHead(200, {
        'Content-Type': 'text/html'
      });
      var html = fs.readFileSync("stattrak.html");
      res.end(html);
    });

    //cfg file downloaden
    dispatcher.onGet("/gamestate_integration_stattrak.cfg", function(req, res) {
      res.writeHead(200, {
        'Content-Type': 'text/*'
      });
      var html = fs.readFileSync("gamestate_integration_stattrak.cfg");
      res.end(html);
    });

    /*//keine ahnung was das tut, einfach mal sein lassen
    dispatcher.beforeFilter(/\//, function(req, res, chain) { //any url
		console.log("Before filter");
		chain.next(req, res, chain);
	});

	dispatcher.afterFilter(/\//, function(req, res) { //any url
		console.log("After filter");
		chain.next(req, res, chain);
	});*/

    dispatcher.onError(function(req, res) {
      console.log("ERROR");
      res.writeHead(404);
      res.write("<html>404 not found</html>");
      res.end('');
    });

    /*----------------XMLHTTP-REQUESTS----------------------------------*/

    //User-login
    dispatcher.onPost("/userLogin", function(req, res) {
      var json = JSON.parse(req.body);
      console.log(json);
      var login = json['id'];
      var nick;
      var remember = json.remember;

      //db nach usernick durchsuchen
      mdb.connect(url, function(err, db) {
        assert.equal(err, null);
        queryUser(db, login, function(ni) {
          if (nick != "") {
            nick = ni;
          } else {
            nick = "not set"
          }
          db.close();
        });
      });


      //Cookies beim Client für SteamID und nicknamen setzen
      if (remember) {
        //wenn remember me angehakt, expiration date sehr hoch setzen
        var now = new Date();
        var expirationDate = Date.now() + (1000 * 36000 * 10000);
        now.setTime(expirationDate);
        res.writeHead(200, [
          ['Set-Cookie', 'login=' + login + "; expires=" + now.toGMTString()],
          ['Set-Cookie', 'nick=' + nick + "; expires=" + now.toGMTString()],
        ]);
      } else {
        res.writeHead(200, [
          ['Set-Cookie', 'login=' + login],
          ['Set-Cookie', 'nick=' + nick],
        ]);
      }

      res.end(login);
    });

    //.cfgfile cachen
    dispatcher.onPost("/cacheCfgFile", function(req, res) {
      //login erhalten
      var login = req.body;
      console.log("Cfg.-File Request für UserId: " + login);
      //file schreiben
      //TODO fixen
      var configFileBody = {
        "uri": 'http://' + '192.168.0.36' + ':' + port, //ggf URL duch host ersetzen
        "timeout": "5.0",
        "buffer": "0.1",
        "throttle": "0.5",
        "heartbeat": "10.0",
        "auth": {
          "token": "" + login + ""
        },
        "data": {
          "provider": "1",
          "map": "1",
          "round": "1",
          "player_id": "1",
          "player_state": "1",
          "player_weapons": "1",
          "player_match_stats": "1"
        }
      };

      var configString = JSON.stringify(configFileBody);
      //kommas und doppelpunkte herausnehmen
      var configStringClean = "";
      for (i = 0; i < configString.length; i++) {
        if (configString.charCodeAt(i) != 58 && configString.charCodeAt(i) != 44) {
          configStringClean += configString.charAt(i);
        } else if (i > 8 && i < 29) { //url unbeschädigt lassen
          configStringClean += configString.charAt(i);
        }
      }

      var cfgFile = fs.writeFile('gamestate_integration_stattrak.cfg', configStringClean, function(err) {
        //pfp download seite als response senden
        console.log("gamestate_integration_stattrak.cfg geschrieben.");
        res.writeHead(200, {
          'Content-type': 'text/HTML'
        });
        res.end();
      });
    });


    //TODO letzte Ticks auslesen
    dispatcher.onPost("/getLastTick", function(req, res) {
      //login und letzten Tick erhalten
      var reqPl = JSON.parse(req.body);
      var login = reqPl.login;
      var lastTick = reqPl.lastTickId;

      mdb.connect(url, function(err, db) {
        assert.equal(err, null);
        //db query last ticks
        queryNewTick(db, login, function(matchid, lastTick) {
          //kein neuer tick
          if (typeof ticks === 'undefined') {
            res.writeHead(200, {
              'content-type': 'text/plain'
            });
            res.write('no new ticks');
            res.end('\n');
          } //neue ticks senden
          else {
            //newTicks.forEach()
            response.writeHead(200, {
              'content-type': 'text/json'
            });
            //response
            response.write(JSON.stringify(ticks));
            response.end('\n');
          }

        })
      })
    })
  }
}

/*-----------------------------HTTP SERVER ERSTELLEN---------------------*/
var server = http.createServer(handleRequest);
server.listen(port, host);
console.log('Listening at http://' + host + ':' + port);

/*-----------------------------EVENT-HANDLING MIT CLIENT--------------------------------*/
var io = require('socket.io')(server, {
  serveClient: false
});
io.on("connection", function(socket) {

  sendTick = function(payload) {
    console.log(chalk.cyan("Sende Payload über Socket"));
    //payload an den raum mit steamid des spielers senden
    io.sockets.in(payload.player.steamid.toString()).emit('sendTick', JSON.stringify(payload));
  }

  console.log(chalk.cyan("Neuer User connected"));
  socket.emit('consoleLog', "Connected!");
  //client-login
  socket.on("login", function(userId) {
    socket.join(userId);
    //id an socket anfügen
    socket.username = userId;
    socket.emit('consoleLog', "User " + socket.username + " connected with Stattrak-Socket.");
    //id speichern
    socketListeners.push(socket.username);
    console.log(chalk.cyan("User " + socket.username + " joined Stattrak-Socket."));
  });
  //client-logout
  socket.on('logout', function() {
    socket.emit('consoleLog', "User " + socket.username + " logged out");
    console.log(chalk.cyan("User " + socket.username + " logged out"));
    //id aus socketlistnerpool entfernen
    socketListeners.splice(socketListeners.indexOf(socket.username), 1);
    socket.join();
  });
  //client-disconnect
  socket.on('disconnect', function() {
    socket.emit('consoleLog', "User " + socket.username + " disconnected.");
    console.log(chalk.cyan("User " + socket.username + " disconnected."));
    //id aus socketlistenerpool entfernen
    socketListeners.splice(socketListeners.indexOf(socket.username), 1);
  });
});

http = require('http');
fs = require('fs');
serialport = require('serialport');
 
port = 3000;
host = '127.0.0.1';
SerialPort = serialport.SerialPort;
arduinoPort = '/dev/ttyUSB2';

var printLog = true;
var playerRoundKills = 0;
var playerTotalKills;
var roundLive = false;

//open port
var myPort = new SerialPort(arduinoPort);
serialport.on('open', function(){
  console.log('Serial Port Opend');
  serialport.on('data', function(data){
      console.log(data[0]);
  });
});

//implementation of abstract port functions
myPort.on('open', showPortOpen);
myPort.on('data', sendSerialData);
myPort.on('close', showPortClose);
myPort.on('error', showError);

function showPortOpen() {
   console.log('port open. Data rate: ' + myPort.options.baudRate);
}
 
function sendSerialData(data) {
   console.log(data[0]);
}
 
function showPortClose() {
   console.log('port closed.');
}
 
function showError(error) {
   console.log('Serial port error: ' + error);
}

myPort.on("open", function () {
  console.log('open');
myPort.write(10, function(err, results) {
    if(err != null)console.log('Fehler beim ersten senden: ' + err);
    if(results != null)console.log("Killcount erstmals gesendet: "+results);
  });
});

console.log("Killcount lesen");
		
		playerTotalKills = parseInt(fs.readFileSync("killcount.txt"));
		
console.log("Killcount beim Initieren: "+ playerTotalKills);

server = http.createServer( function(req, res) {		//server erstellen
 
    if (req.method == 'POST') {
        console.log("Handling POST request...");
        res.writeHead(200, {'Content-Type': 'text/html'});
 
		var payload;
		
        req.on('data', function (data) {
			//daten aus dem spiel einlesen
			payload = JSON.parse(data);			//payload als objeckt einlesen
			
			//checken, ob objekt definiert ist, um fehler zu vermeiden
			if(typeof payload.player !== 'undefined' && typeof payload['round'] !== 'undefined') {
				
				//zuletzt erhaltene round_kills in eine variable setzen
				currRoundKills = payload.player.state['round_kills'];
				
				//playerTotalKills aktualisieren
				playerTotalKills = parseInt(fs.readFileSync("killcount.txt"));
				console.log("Aktuelle PlayerTotalKills: " + playerTotalKills);
				
				//checken, ob runde läuft oder grade vorbei ist
				if(payload['round'].phase == 'live' || payload['round'].phase == 'over') {
					roundLive = true;	
				} else {
					roundLive = false;
						}
			
				//playerRoundKills aktualisieren, wenn Runde läuft und neuer Wert ungleich ist
					if(roundLive && playerRoundKills != currRoundKills) {
						var deltaRoundKills = currRoundKills - playerRoundKills;			//errechne die differenz zwischen alten und neuen daten
						playerRoundKills = currRoundKills;									//neue daten altern lassen
						playerTotalKills = playerTotalKills + deltaRoundKills;				//playerTotalKills aktualisieren
						
						//neuen Killcount speichern wenn änderung vorliegt
						console.log("Kills werden gespeichert...");
						if(deltaRoundKills != 0) {
						
						 try{
								var data = fs.writeFileSync('killcount.txt', playerTotalKills);
								console.log("Killcount gespeichert");
myPort.write(playerTotalKills, function(err, results) {
    console.log('err ' + err);
    console.log("Killcount an Arduino gesendet "+results);
  });
							}catch(e){
								console.log("speichern fehlgeschlagen!");
							} 
					} 
				}else if (!roundLive) {playerRoundKills = 0;}		//playerRoundKills am Ende jeder Runde zurücksetzen
				
					/*if(playerRoundKills != currRoundKills && roundLive == true) {
						playerRoundKills = payload.player.state['round_kills'];
					};*/
			}
					
		});
		
        req.on('end', function () {
            console.log(payload);
			console.log("Round Live: " + roundLive);
			console.log("Player Round Kills: " + playerRoundKills);
			console.log("Player Total Kills: " + playerTotalKills);
			res.end( '' );
        });
    }
    else
    {
        console.log("Not expecting other request types...");
        res.writeHead(200, {'Content-Type': 'text/html'});
		var html = '<html><body>HTTP Server at http://' + host + ':' + port + '</body></html>';
        res.end(html);
    }
 
});

 
server.listen(port, host);
console.log('Listening at http://' + host + ':' + port);

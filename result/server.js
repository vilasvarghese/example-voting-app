var express = require('express'),
    async = require('async'),
    { Pool } = require('pg'),
    fs = require('fs'),
    path = require('path'),
    cookieParser = require('cookie-parser'),
    app = express(),
    server = require('http').Server(app),
    io = require('socket.io')(server);

io.set('transports', ['polling']);

var port = process.env.PORT || 4000;

// Read DB credentials from Vault-injected file
const vaultSecretPath = '/vault/secrets/db-creds';
let dbUser, dbPass;

try {
    const secretData = fs.readFileSync(vaultSecretPath, 'utf8').trim().split('\n');
    secretData.forEach(line => {
        const [key, value] = line.split('=');
        if (key === 'username') dbUser = value.trim();
        if (key === 'password') dbPass = value.trim();
    });

    if (!dbUser || !dbPass) {
        throw new Error('Missing username or password in Vault file');
    }
    console.log('Loaded DB credentials from Vault secret file');
} catch (err) {
    console.error('Failed to load DB credentials:', err.message);
    process.exit(1);
}

// Host and DB name
const dbHost = 'db';
const dbName = 'postgres';

// Build connection string
const connectionString = `postgres://${dbUser}:${dbPass}@${dbHost}/${dbName}`;
console.log(`Connecting to DB at ${dbHost} as ${dbUser}`);

var pool = new Pool({ connectionString });

async.retry(
    {times: 1000, interval: 1000},
    function(callback) {
        pool.connect(function(err, client, done) {
            if (err) {
                console.error("Waiting for db");
            }
            callback(err, client);
        });
    },
    function(err, client) {
        if (err) {
            return console.error("Giving up");
        }
        console.log("Connected to db");
        getVotes(client);
    }
);

function getVotes(client) {
    client.query('SELECT vote, COUNT(id) AS count FROM votes GROUP BY vote', [], function(err, result) {
        if (err) {
            console.error("Error performing query: " + err);
        } else {
            var votes = collectVotesFromResult(result);
            io.sockets.emit("scores", JSON.stringify(votes));
        }
        setTimeout(function() { getVotes(client); }, 1000);
    });
}

function collectVotesFromResult(result) {
    var votes = {a: 0, b: 0};
    result.rows.forEach(function (row) {
        votes[row.vote] = parseInt(row.count);
    });
    return votes;
}

app.use(cookieParser());
app.use(express.urlencoded());
app.use(express.static(__dirname + '/views'));

app.get('/', function (req, res) {
    res.sendFile(path.resolve(__dirname + '/views/index.html'));
});

server.listen(port, function () {
    var port = server.address().port;
    console.log('App running on port ' + port);
});

io.on('connection', function (socket) {
    socket.emit('message', { text : 'Welcome!' });
    socket.on('subscribe', function (data) {
        socket.join(data.channel);
    });
});

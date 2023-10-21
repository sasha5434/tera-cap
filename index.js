const config = require("config")
const express = require('express')
const { PcapCapture } = require('./app/sniffer')
const outputDelay = require('./app/delay')
const { Matchings } = require('./app/models/matching')

const variables = {
    dungeons: new Matchings(),
    battlegrounds: new Matchings(),
    endSessionHandler: function(session) {
        
        const name = session?.connection?.userinfo?.character?.name;
        if (name === undefined)
            return;

        this.dungeons.tryRemoveByPlayerName(name);
        this.battlegrounds.tryRemoveByPlayerName(name);
    }
}

const teraSniffer = new PcapCapture ({ listen_ip: config.get('listen_ip'), server_ip: config.get('server_ip'), server_port: config.get('server_port')}, variables)
teraSniffer.listen()

const app = express()
const port = config.get('webserver_port')

app.use(
    function (req, res, next) {
        req.sessions = teraSniffer.tcpTracker.sessions
        req.variables = variables
        next()
    }
)

app.get('/online', (req, res) => {
    const online = []
    for (const key of Object.keys(req.sessions)) {
        if (req.sessions[key].connection.userinfo.inGame)
            try {
                online.push({
                    id: req.sessions[key].connection.userinfo.character.id,
                    name: req.sessions[key].connection.userinfo.character.name,
                    level: req.sessions[key].connection.userinfo.character.level,
                    gender: req.sessions[key].connection.userinfo.characters[req.sessions[key].connection.userinfo.character.id].gender,
                    race: req.sessions[key].connection.userinfo.characters[req.sessions[key].connection.userinfo.character.id].race,
                    class: req.sessions[key].connection.userinfo.characters[req.sessions[key].connection.userinfo.character.id].class
                })
            } catch (err) { console.log(err) }
    }
    res.json(online)
})

app.get('/dungeons', (req, res) => {
    let dg;
    try {
        req.variables.dungeons.link(req.sessions);
        dg = req.variables.dungeons.getGroupedByInstance();
    } catch (err) { console.log(err) }
    res.json(dg)
})

app.get('/battlegrounds', (req, res) => {
    let bg;
    try {
        req.variables.battlegrounds.link(req.sessions);
        bg = req.variables.battlegrounds.getGroupedByInstance();
    } catch (err) { console.log(err) }
    res.json(bg)
})

app.listen(port, config.get('listen_ip'), () => {
    console.log(`WebServer listening on port ${port}`)
})

outputDelay(300)
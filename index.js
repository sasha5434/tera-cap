const config = require("config")
const express = require('express')
const { PcapCapture } = require('./app/sniffer')
const outputDelay = require('./app/delay')

const variables = {
    dungeons: new Object(null),
    bttlefields: new Object(null)
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

app.listen(port, config.get('listen_ip'), () => {
    console.log(`WebServer listening on port ${port}`)
})

outputDelay(300)
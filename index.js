const config = require("config")
const { PcapCapture } = require('./app/sniffer')
const outputDelay = require('./app/delay')

const teraSniffer = new PcapCapture ({ listen_ip: config.get('listen_ip'), server_ip: config.get('server_ip'), server_port: config.get('server_port')})
teraSniffer.listen()

outputDelay(300)
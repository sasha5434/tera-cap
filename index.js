const config = require("config")
const { PktCaptureAll, PktCaptureMode } = require('./app/sniffer')
const outputDelay = require('./app/delay')

const capture = new PktCaptureAll((config.get('rawCapture')) ? PktCaptureMode.MODE_RAW_SOCKET : PktCaptureMode.MODE_PCAP, config.get('port'))

console.log(
    `Listening on ${capture.captures.size} devices(s): ${Array.from(
        capture.captures.keys()
    ).join(", ")}`
)

outputDelay(300)
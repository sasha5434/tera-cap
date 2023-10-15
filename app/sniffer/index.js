const cap = require("cap-rbfork")
const { EventEmitter } = require('node:events');
const { TCPSession, TCPTracker } = require("./tcp_tracker")
const { Ethernet, PROTOCOL, IPV4, TCP } = cap.decoders;

const PktCapture = class extends EventEmitter {
  tcpTracker
  device
  server_port
  constructor(listen_options) {
    super();
    this.listen_ip = listen_options.listen_ip;
    this.server_port = listen_options.server_port;
    this.tcpTracker = new TCPTracker(listen_options);
    this.tcpTracker.on("session", (session) => {
      console.info(
        `[sniffer/pkt-capture] - New session ${session.src}->${session.dst} ${
          session.is_ignored ? "(ingored) " : ""
        }(Total: ${Object.keys(this.tcpTracker.sessions).length})`
      );
      session.on("payload_recv", (data) => {
        this.emit("packet", data, 'recv');
      });
      session.on("payload_send", (data) => {
        this.emit("packet", data, 'send');
      });
      if (session.dst) this.emit("connect", session.dst);
    });
  }
  dispatchPacket(packet) {
    const ethernet = Ethernet(packet);
    if (ethernet.info.type === PROTOCOL.ETHERNET.IPV4) {
      const ipv4 = IPV4(packet, ethernet.offset);
      if (ipv4.info.protocol === PROTOCOL.IP.TCP) {
        const tcp = TCP(packet, ipv4.offset);
        this.tcpTracker.track_packet(packet, ipv4, tcp);
      }
    }
  }
}
class PcapCapture extends PktCapture {
  c
  #buffer
  constructor(listen_options) {
    //TODO: check device format (must be device path)
    super(listen_options); //Sets TCPTracker
    this.c = new cap.Cap();
    this.device = cap.findDevice(this.listen_ip);
    console.log(`Listening on ${this.device}`)
    this.#buffer = Buffer.alloc(65535);
  }
  listen(){
    const linkType = this.c.open(
      this.device,
      `tcp and (src port ${this.server_port} or dst port ${this.server_port})`,
      10 * 1024 * 1024,
      this.#buffer
    );
    if (this.c.setMinBytes) this.c.setMinBytes(54); // pkt header size
    this.c.on("packet", (nbytes, truncated) => {
      if (linkType === "ETHERNET") {
        this.dispatchPacket(this.#buffer);
      } else if (linkType === "NULL" && this.device === "\\Device\\NPF_Loopback") {
        const type = this.#buffer.readUInt32LE();
        //IP header loopback
        if (type !== 2) return;
        this.dispatchPacket(this.#buffer.subarray(4));
      }
    });
  }
}

module['exports'] = {
  PcapCapture
}
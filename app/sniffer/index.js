const cap = require("cap-rbfork")
const { execSync } = require("child_process")
const { isIPv4 } = require("net")
const { networkInterfaces } = require("os")
const { RawSocket } = require("raw-socket-sniffer")
const { EventEmitter } = require('node:events');
const { TCPSession, TCPTracker } = require("./tcp_tracker")

const { findDevice, deviceList } = cap.Cap;
const { Ethernet, PROTOCOL, IPV4, TCP } = cap.decoders;

const PktCapture = class extends EventEmitter {
  tcpTracker
  device
  port
  constructor(device, listen_options) {
    super();
    this.device = device;
    this.port = listen_options.port;
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
  constructor(device, listen_options) {
    //TODO: check device format (must be device path)
    super(device, listen_options); //Sets TCPTracker
    this.c = new cap.Cap();
    this.#buffer = Buffer.alloc(65535);
  }
  listen(){
    const linkType = this.c.open(
      this.device,
      `tcp and (src port ${this.port} or dst port ${this.port})`,
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
  close() {
    this.c.close();
  }
}
class RawSocketCapture extends PktCapture {
  rs;
  constructor(ip, listen_options) {
    //TODO: check device format (must be IP)
    super(ip, listen_options); //Sets TCPTracker
    this.rs = new RawSocket(ip, listen_options.port);
  }
  listen() {
    this.rs.on("data", this.dispatchPacket.bind(this));
    this.rs.listen();
  }
  close() {
    //TODO: implement clean close in RawSocket addon
  }
}

const PktCaptureMode = {
  MODE_PCAP: 0,
  MODE_RAW_SOCKET: 1
}

const PktCaptureAll = class extends EventEmitter {
  captures

  constructor(mode, port = 6040) {
    super();
    this.captures = new Map();

    if (!adminRelauncher(mode)) {
      console.warn(
        "[sniffer/PktCaptureAll] - Couldn't restart as admin, fallback to pcap mode, consider starting as admin yourself."
      );
      mode = PktCaptureMode.MODE_PCAP;
    }

    if (mode === PktCaptureMode.MODE_RAW_SOCKET) {
      //Already as admin, add firewell rule
      updateFirewall();
    }

    if (mode === PktCaptureMode.MODE_PCAP) {
      for (const device of deviceList()) {
        for (const address of device.addresses) {
          if (address.addr && address.netmask && isIPv4(address.addr)) {
            try {
              const pcapc = new PcapCapture(device.name, {
                ip: address.addr,
                mask: address.netmask,
                port,
              });
              // re-emit
              pcapc.on("packet", (buf) => this.emit("packet", buf, device.name));
              pcapc.on("connect", (ip) => this.emit("connect", ip, device.name));
              this.captures.set(device.name, pcapc);
              pcapc.listen();
            } catch (e) {
              console.error(`[sniffer/PktCaptureAll] ${e}`);
            }
          }
        }
      }
    } else if (mode === PktCaptureMode.MODE_RAW_SOCKET) {
      // [Warning] require privileges
      for (const addresses of Object.values(networkInterfaces())) {
        for (const device of addresses ?? []) {
          if (
            isIPv4(device.address) &&
            device.family === "IPv4" &&
            device.internal === false &&
            !this.captures.has(device.address) // Some users have multiple interfaces with same ip, we want only 1
          ) {
            try {
              const rsc = new RawSocketCapture(device.address, {
                ip: device.address,
                mask: device.netmask,
                port,
              });
              // re-emit
              rsc.on("packet", (buf) => this.emit("packet", buf, device.address));
              this.captures.set(device.address, rsc);
              rsc.listen();
            } catch (e) {
              console.error(`[sniffer/PktCaptureAll] ${e}`);
            }
          }
        }
      }
    } else {
      //Unknown PktCaptureMode, ignoring
    }
  }

  close() {
    for (const cap of this.captures.values()) cap.close();
  }
}

function updateFirewall() {
  const command = `netsh advfirewall firewall delete rule name="tera-sniffer" & netsh advfirewall firewall add rule name="tera-sniffer" dir=in action=allow program="${process.argv[0]}"`;
  execSync(command, {
    stdio: "inherit",
  });
}

function getArgList(args) {
  const filtered = args.filter((a) => a !== "");
  if (filtered.length === 0) return "'-relaunch'";
  return "'" + filtered.join("','") + "','-relaunch'";
}
function isAdmin() {
  //Made sync from https://github.com/sindresorhus/is-admin/blob/main/index.js
  try {
    execSync(`fsutil dirty query ${process.env["systemdrive"] ?? "c:"}`);
  } catch {
    return false;
  }
  return true;
}
/**
 *
 * @returns False if we have to fall back to pcap, process exit if not, True if already in admin state
 */
function adminRelauncher(mode) {
  if (mode !== PktCaptureMode.MODE_RAW_SOCKET) return true;
  //Check if we started our process with the -relaunch paramater (which means that it failed, and we want to fall back to pcap instead)

  if (process.argv.includes("-relaunch")) return true; // We assume that we already relaunched successfully earlier, so we don't need to check admin again
  if (isAdmin()) return true;
  //TODO: maybe implement another way with Elevate.exe that is shipped with electron (for ppl that doesn't have powershell installed)
  const command = `cmd /c "powershell -Command Start-Process -FilePath '${
    process.argv[0]
  }' -Verb RunAs -ArgumentList ${getArgList(process.argv.splice(1))}"`;

  try {
    execSync(command, {
      stdio: "inherit",
    });
  } catch (e) {
    console.info(`[sniffer/pkt-capture] - ${e}`);
    return false;
  }
  process.exit(0);
}

module['exports'] = {
  findDevice,
  deviceList,
  PktCaptureAll,
  PktCaptureMode
}
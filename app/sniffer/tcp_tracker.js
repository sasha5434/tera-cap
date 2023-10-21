const colors= require("colors")
const { EventEmitter } = require("stream")
const { IPTracker } = require("./ip_tracker")
const TeraProtocol = require('../tera-protocol')
const checksum = require("./checksum");

const TCPTracker = class extends EventEmitter {
  sessions
  listen_options
  variables
  constructor(listen_options, variables) {
    super();
    this.sessions = {};
    this.variables = variables
    this.listen_options = listen_options;
    EventEmitter.call(this);
  }
  async track_packet(buffer, ip, tcp) {
    let src = ip.info.srcaddr + ":" + tcp.info.srcport;
    let dst = ip.info.dstaddr + ":" + tcp.info.dstport;
    let key;
    if (src < dst) {
      key = src + "-" + dst;
    } else {
      key = dst + "-" + src;
    }

    let is_new = false;
    let session = this.sessions[key];
    if (!session) {
      //if (tcp.info.flags & TCPFlags.rst || tcp.info.flags & TCPFlags.fin) return; //Connexion is supposed to be closing, ignoring
      if (!(tcp.info.flags & 8 /* psh */) && !(tcp.info.flags & 2 /* syn */)) return; //Wait for a syn or psh to create session
      is_new = true;
      session = new TCPSession(this.listen_options, this.variables);
      this.sessions[key] = session;
      session.on("end", () => {
        this.variables.endSessionHandler(this.sessions[key]);
        delete this.sessions[key];
        console.info(
          `[sniffer/tcp-tracker] - Close session ${session?.src} (Total: ${
            Object.keys(this.sessions).length
          })`
        );
      });
    }

    session.track(buffer, ip, tcp);

    // need to track at least one packet before we emit this new session, otherwise nothing
    // will be initialized.
    if (is_new) {
      this.emit("session", session);
    }
  }
}

const TCPSession = class extends EventEmitter {
  state;
  src;
  dst;

  send_seqno; // Current seq number flushed
  send_buffers;

  recv_seqno; // Current seq number flushed
  recv_buffers;
  listen_options;

  is_ignored;

  send_ip_tracker;
  recv_ip_tracker;

  skip_socks5;
  in_handshake;

  protocol;

  constructor(listen_options, variables) {
    super();
    this.listen_options = listen_options;

    this.state = "NONE";
    this.send_seqno = 0;
    this.send_buffers = [];

    this.recv_seqno = 0;
    this.recv_buffers = [];
    this.is_ignored = false;

    this.send_ip_tracker = new IPTracker();
    this.recv_ip_tracker = new IPTracker();
    this.send_ip_tracker.on("segment", this.handle_send_segment.bind(this));
    this.recv_ip_tracker.on("segment", this.handle_recv_segment.bind(this));

    this.skip_socks5 = 0;
    this.in_handshake = true;

    this.connection = new TeraProtocol(variables);

    EventEmitter.call(this);
  }
  async track(buffer, ip, tcp) {
    let src = ip.info.srcaddr + ":" + tcp.info.srcport;
    let dst = ip.info.dstaddr + ":" + tcp.info.dstport;
    //console.log(src, dst, tcp.info.seqno, tcp.info.ackno);
    if (this.state === "NONE") {
      const toServer = this.listen_options.server_ip === ip.info.dstaddr
      if (toServer && this.listen_options.server_port === tcp.info.dstport) {
        //internet:????->server(xx.xx.xx.xx:7801)
        this.src = src;
        this.dst = dst;
      } else {
        this.src = dst;
        this.dst = src;
        this.is_ignored = true;
      }
      this.state = "ESTAB";
    }
    if (tcp.info.flags & 4 /* rst */ || tcp.info.flags & 1 /* fin */) {
      //Process last data received
      this.ESTAB(buffer, ip, tcp);
      this.emit("end", this);
    } else {
      //process estab
      this.ESTAB(buffer, ip, tcp);
    }
  }

  ESTAB(buffer, ip, tcp) {
    if (this.is_ignored) return; //Ignore data transfert
    let src = ip.info.srcaddr + ":" + tcp.info.srcport;
    if (src === this.src) {
      if (checksum(buffer, ip, tcp)){
        this.handle_recv_segment(buffer, ip, tcp);
      } else {
        console.log(colors.yellow("[sniffer/tcp_tracker] - Skipp packet (checksum) length: " + ip.info.totallen));
      }
    } else if (src === this.dst) {
      this.handle_send_segment(buffer, ip, tcp);
    } else {
      console.error("[sniffer/tcp_tracker] - non-matching packet in session: ip=" + ip + "tcp=" + tcp);
    }
  }

  flush_buffers(ackno, direction) {
    //We assume that seqno/ackno will never overflow (2^32 bytes ~ 4.3GB)
    if (direction === "recv") {
      //Update seqno when unknown
      if (this.recv_seqno === 0) {
        this.recv_seqno = ackno;
      }
      //Get ordered buffers
      const flush_payload = TCPSession.get_flush(this.recv_buffers, this.recv_seqno, ackno);

      if (!flush_payload) {
        //can't flush payload, missing some of it, dropping
        return;
      }
      this.recv_seqno = ackno;
      if (this.in_handshake && flush_payload.length === 2 && flush_payload.equals(Buffer.from([5, 2])))
        this.skip_socks5 = 4;
      if (this.skip_socks5 > 0) {
        this.skip_socks5--;
        return;
      }
      this.in_handshake = false;
      //this.emit("payload_recv", flush_payload);
      this.connection.packetHandler(flush_payload, true)
    } else if (direction === "send") {
      //Update seqno when unknowny
      if (this.send_seqno === 0) this.send_seqno = ackno;
      //Get ordered buffers
      const flush_payload = TCPSession.get_flush(this.send_buffers, this.send_seqno, ackno);
      if (!flush_payload) {
        //can't flush payload, missing some of it, dropping
        return;
      }
      this.send_seqno = ackno;
      //this.emit("payload_send", flush_payload);
      this.connection.packetHandler(flush_payload, false)
    }
  }
  static get_flush(buffers, seqno, ackno) {
    const totalLen = ackno - seqno;
    if (totalLen <= 0) return null;
    let flush_payload = Buffer.alloc(totalLen);
    let flush_mask = Buffer.alloc(totalLen);
    const newBuffers = buffers.filter((segment) => {
      if (segment.seqno > ackno) return true; //Not aknowledged, keep the payload for later
      if (segment.seqno < seqno) {
        // Our segment is fully outdated, drop it
        if (segment.seqno + segment.payload.length < seqno) return false;

        //Our stored segent contains data that has already been flushed, edit it
        segment.payload = segment.payload.subarray(seqno - segment.seqno);
        segment.seqno = seqno;
      }
      //Append payload to flush payload
      /**
       * 5 cases:
       * - segment is the same size & perfect fit
       * - semgent is shorter (inside)
       * - segment is the same size & overlap (after)
       * - segment is shorter and overlap (after)
       * - segment is longer and overlap (after)
       * ----------
       * Early overlap doesn't exist as we drop that data just before, so we always copy segment from 0
       */
      const flush_offset = segment.seqno - seqno;
      const len_to_flush = Math.min(ackno - segment.seqno, segment.payload.length);
      segment.payload.copy(flush_payload, flush_offset, 0, len_to_flush);
      flush_mask.fill(1, flush_offset, flush_offset + len_to_flush);
      if (len_to_flush < segment.payload.length) {
        //Segment is overlapping
        segment.payload = segment.payload.subarray(len_to_flush);
        segment.seqno += len_to_flush;
        return true;
      }
      return false;
    });
    //TODO: use a mask (or anything) to be sure we got all the portions of the payload
    //We apply the mask to remove unknown portions (probably can be fixed by implementing sack)
    if (flush_mask.includes(0)) {
      //console.log(flush_mask.toString("hex"));
      if (buffers.length >= 50) {
        //clear buffers
        while (buffers.length >= 50)
          buffers.shift()
      }
      return null;
    } else {
      //TODO: reset fail count as we successfully flushed
      //Update stored buffers:
      buffers.length = 0;
      buffers.push(...newBuffers);
      return flush_payload;
    }
  }
  handle_recv_segment(packet, ip, tcp) {
    const tcpDataLength = ip.info.totallen - ip.hdrlen - tcp.hdrlen;
    let is_sack = false;
    try {
      is_sack = is_sack_in_header(packet, ip, tcp);
    } catch (e) {
      console.error(e);
      return;
    }
    // this packet came from the active opener / client
    if (tcpDataLength > 0) {
      //We store the segment in the buffers list
      this.send_buffers.push({
        seqno: tcp.info.seqno,
        payload: Buffer.from(packet.subarray(tcp.offset, tcp.offset + tcpDataLength)),
      });
    }
    if (tcp.info.ackno && !is_sack) {
      this.flush_buffers(tcp.info.ackno ?? 0, "recv");
    }
  }
  handle_send_segment(packet, ip, tcp) {
    const tcpDataLength = ip.info.totallen - ip.hdrlen - tcp.hdrlen;
    let is_sack = false;
    try {
      is_sack = is_sack_in_header(packet, ip, tcp);
    } catch (e) {
      console.error(e);
      return;
    }
    if (tcpDataLength > 0) {
      //We store the segment in the buffers list
      this.recv_buffers.push({
        seqno: tcp.info.seqno,
        payload: Buffer.from(packet.subarray(tcp.offset, tcp.offset + tcpDataLength)),
      });
    }
    if (tcp.info.ackno && !is_sack) {
      this.flush_buffers(tcp.info.ackno ?? 0, "send");
    }
  }
}
function is_sack_in_header(buffer, ip, tcp) {
  if (tcp.hdrlen === 20) return false;
  //Parse TCP Options (//TODO: move to cap/decoders ?)
  let options_offset = ip.offset + 20;
  const options_len = tcp.hdrlen - 20;
  const end_offset = options_offset + options_len;
  while (options_offset < end_offset) {
    switch (buffer[options_offset]) {
      case 0: //end
        options_offset = end_offset;
        break;
      case 1: //pad/nop
        options_offset += 1;
        break;
      case 2: //mss
        options_offset += 4;
        break;
      case 3: //window_scale
        options_offset += 3;
        break;
      case 4: //sack_ok
        options_offset += 2;
        break;
      case 5:
        //We don't need to parse sack, we just want to know that there is
        return true;
      case 8: //timestamp
        options_offset += 10;
        break;
      case 254: //rfc8994
      case 255:
        options_offset += buffer[options_offset + 1] ?? 1;
        break;
      default:
        throw new Error(
          `[sniffer/tcp-tracker] - Unknown TCPOption ${buffer[options_offset]}, packet is probably malformed, should drop.`
        ); //unknown option drop packet
    }
  }
  return false;
}

module['exports'] = {
  TCPTracker,
  TCPSession
}
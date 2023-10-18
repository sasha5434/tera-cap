function ipToBuffer(ip, buff, offset) {
    ip.split(/\./g).map((byte) => {
        buff.writeUInt8(byte, offset++);
    });
}

function csum16_f(value) {
    const temp = Buffer.alloc(4);
    temp.writeUInt32BE(value, 0);
    return temp.readUInt16BE(0, 2) + temp.readUInt16BE(2, 4);
}

function csum16(buffer) {
    let sum = 0;
    while (buffer.length > 1) {
        sum += buffer.readUInt16BE(0, 2);
        buffer = buffer.slice(2);
    }
    while (sum > 65535)
        sum = csum16_f(sum);
    return 65535 - sum;
}

function check(packet, ip, tcp) {
    const header = Buffer.from([
        0x00, 0x00, 0x00, 0x00,  // Sender Protocol address (ipv4) (32 bits)
        0x00, 0x00, 0x00, 0x00,  // Target Protocol address (ipv4) (32 bits)
        0x00,                    // Reserved (8 bits) fixed 0
        0x06,                    // Protocol field (8 bit) for TCP, the value is 6
        0x00, 0x00               // TCP segment length (16 bits)
    ])
    ipToBuffer(ip.info.srcaddr, header, 0);
    ipToBuffer(ip.info.dstaddr, header, 4);

    //TCP segment length
    const tcplen = ip.info.totallen - ip.hdrlen;
    //write TCP segment length
    header.writeUInt16BE(tcplen, 10);
    //create new buffer for pseudo header + TCP segment
    let forCheck = Buffer.alloc(((tcplen % 2 === 0) ? tcplen : tcplen + 1)  + 12);
    //write pseudo header
    header.copy(forCheck);
    //write TCP segment
    packet.copy(forCheck, 12, ip.offset, ip.offset + tcplen)
    //set checked packet checksum = 0 for correct check
    forCheck.writeUInt16BE(0, 28);

    return tcp.info.checksum === csum16(forCheck);
}

module['exports'] = check
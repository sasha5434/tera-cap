const colors = require("colors")
const skipOver = 65535;
class PacketBuffer {
    constructor(dispatch, incoming) {
        this.incoming = incoming
        this.dispatch = dispatch
        this.buffer = null;
        this.position = 0;
        this.skipped = false;
        this.skip = function () {
            this.buffer = null;
            this.position = 0;
            this.skipped = true;
        }
    }

    async write(data) {
        if (this.skipped) {
            if (data.length <= 200) {
                this.skipped = false;
            }
        } else {
            // we'll chop off the front of `data` with each loop
            while (data.length > 0) {
                // if we have a buffer prepared, we should append to it first
                if (this.buffer != null) {
                    // if our buffer size is less than 2, we'll need to compute the full size
                    if (this.buffer.length < 2) {
                        /* eslint-disable no-bitwise */
                        const old = this.buffer[0];        // save old byte
                        const size = (data[0] << 8) + old; // convert from little-endian
                        this.buffer = Buffer.alloc(size);  // make new buffer
                        this.buffer[0] = old;              // write old value
                        this.position = 1;                 // update position
                        /* eslint-enable no-bitwise */
                    }

                    // write as many bytes as we can
                    const remaining = Math.min(data.length, this.buffer.length - this.position);
                    data.copy(this.buffer, this.position, 0, remaining);
                    this.position += remaining;

                    // if we filled the buffer, push it
                    if (this.position === this.buffer.length) {
                        try {
                            this.dispatch.handle(this.buffer, this.incoming);
                        } catch (e) {
                            this.skip();
                            break;
                        }
                        this.buffer = null;
                        this.position = 0;
                    }

                    // chop off the front and keep going
                    data = data.slice(remaining);
                    continue;
                }

                // if it's too small to read the size value, just save it in the buffer and
                // we'll hopefully get to it the next time around
                if (data.length < 2) {
                    this.buffer = Buffer.from(data);
                    this.position = data.length;
                    break;
                }

                // otherwise, read the size value, and if it's bigger than the size of the
                // data we have, we should save it in the buffer
                const size = data.readUInt16LE(0);
                if (size > data.length) {
                    this.buffer = Buffer.alloc(size);
                    data.copy(this.buffer);
                    this.position = data.length;
                    break;
                } else if (size === 0) {
                    console.log(colors.red('[tera-protocol/packetBuffer] - Size = 0: ' + data.length))
                    this.skip();
                    break;
                }
                // otherwise, just push it and chop off the front, then keep going
                try {
                    this.dispatch.handle(data.slice(0, size), this.incoming);
                } catch (e) {
                    this.skip();
                    break;
                }
                data = data.slice(size);
            }
        }
    }
}

module.exports = PacketBuffer;

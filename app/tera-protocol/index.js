const Encryption = require('./encryption')
const PacketBuffer = require('./packetBuffer')
const { PacketIntegrity } = require('./integrity');
const PrepareData = require('./data-loader');
const Dispatch = require('./dispatch');
const hooks = require('../tera-hooks');

class reader {
    constructor() {
        this.metadata = PrepareData.metadata
        this.state = -1
        this.session = new Encryption(false) // true for classic
        this.serverBuffer = new PacketBuffer()
        this.clientBuffer = new PacketBuffer()
        this.dispatch = new Dispatch(this);
        this.integrity = null;
        this.hooks = hooks(this.dispatch)

        if (this.metadata.patchVersion >= 100)
            this.dispatch.hook(null, 'S_LOGIN_ACCOUNT_INFO', 3, { order: -Infinity, filter: { incoming: true } }, (event) => {
                this.integrity = new PacketIntegrity(event.antiCheatChecksumSeed);
            });
        else if (this.metadata.patchVersion >= 92)
            this.integrity = new PacketIntegrity(null);
    }

    packetHandler(data, type) {
        if (type) {
            //server block
            switch (this.state) {
                case -1: {
                    if (data.readUInt32LE(0) === 1) {
                        this.state = 0
                    }
                    break
                }
                case 0: {
                    if (data.length === 128) {
                        data.copy(this.session.serverKeys[0])
                        this.state = 1
                    }
                    break
                }
                case 1: {
                    if (data.length === 128) {
                        data.copy(this.session.serverKeys[1])
                        this.session.init()
                        this.state = 2
                    }
                    break
                }
                case 2: {
                    this.session.encrypt(data)
                    this.serverBuffer.write(data)

                    while (data = this.serverBuffer.read()) {
                        if (this.dispatch)
                            data = this.dispatch.handle(data, true);
                    }

                    break
                }
                default: {
                    break
                }
            }
        } else {
            //client block
            switch (this.state) {
                case 0: {
                    if (data.length === 128) {
                        data.copy(this.session.clientKeys[0])
                    }
                    break
                }
                case 1: {
                    if (data.length === 128) {
                        data.copy(this.session.clientKeys[1])
                    }
                    break
                }
                case 2: {
                    this.session.decrypt(data)
                    this.clientBuffer.write(data)

                    while (data = this.clientBuffer.read()) {
                        if (this.dispatch)
                            data = this.dispatch.handle(data, false);
                    }

                    break
                }
                default: {
                    break
                }
            }
        }
    }
}

module['exports'] = reader
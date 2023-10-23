const Encryption = require('./encryption')
const PacketBuffer = require('./packetBuffer')
const { PacketIntegrity } = require('./integrity');
const {metadata, protocol, protocolMap} = require('./data-loader');
const Dispatch = require('./dispatch');
const hooks = require('../tera-hooks');

class connection {
    constructor(variables) {
        this.userinfo = {
            inGame: false,
            id: 0,
            server: '',
            character: {
                gameId: 0,
                name: '',
                level: 0
            },
            characters: new Object(null)
        }
        this.variables = variables
        this.metadata = metadata
        this.protocol = protocol
        this.protocolMap = protocolMap
        this.state = -1
        this.session = new Encryption(false) // true for classic
        this.integrity = null;

        this.dispatch = new Dispatch(this);
        this.serverBuffer = new PacketBuffer(this.dispatch, true)
        this.clientBuffer = new PacketBuffer(this.dispatch, false)
        this.hooks = hooks(this.dispatch)
        if (this.metadata.patchVersion >= 100)
            this.dispatch.hook(null, 'S_LOGIN_ACCOUNT_INFO', 3, { order: -Infinity, filter: { incoming: true } }, (event) => {
                this.integrity = new PacketIntegrity(event.antiCheatChecksumSeed);
            });
        else if (this.metadata.patchVersion >= 92)
            this.integrity = new PacketIntegrity(null);
    }

    async packetHandler(data, type) {
        if (type) {
            //server block
            switch (this.state) {
                case -1: {
                    if (data.length === 4 && data.readUInt32LE(0) === 1) {
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
                    await this.session.encrypt(data)
                    await this.serverBuffer.write(data)
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
                    await this.session.decrypt(data)
                    await this.clientBuffer.write(data)
                    break
                }
                default: {
                    break
                }
            }
        }
    }
}

module['exports'] = connection
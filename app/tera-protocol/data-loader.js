const config = require("config");
const path = require('path');
const fs = require('fs');
const parser = require('tera-data-parser')
const {hasPadding} = require("./integrity");

const dataFolder = path.join(__dirname, '../../', 'data');

const metadata = {
    protocolVersion: config.get('protocolVersion'),
    patchVersion: config.get('patchVersion'),
    maps: { protocol: {}, sysmsg: {} }
}

function LoadProtocolMap(dataFolder, version) {
    const parseMap = require('tera-data-parser').parsers.Map;
    const filename = `protocol.${version}.map`;

    // Load base
    const data = JSON.parse(fs.readFileSync(path.join(dataFolder, 'data.json')));
    let baseMap = data.maps[version] || {};

    // Load custom
    let customMap = {};
    try {
        customMap = parseMap(path.join(dataFolder, 'opcodes', filename));
    } catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }

    return Object.assign(customMap, baseMap);
}

try {
    metadata.maps.protocol = Object.assign(LoadProtocolMap(dataFolder, metadata.protocolVersion), metadata.protocol);

    if (Object.keys(metadata.maps.protocol).length === 0) {
        console.warn('Cant load protocol map version ' + metadata.protocolVersion)
    } else {
        console.log('Loaded protocol map version ' + metadata.protocolVersion)
    }
} catch (e) {
    console.error('Cant load protocol map version ' + metadata.protocolVersion)
    console.error(e);
}

// Initialize protocol maps
const protocolMap = {
    name: new Map(),
    code: new Map(),
    padding: (new Array(0x10000)).fill(false),
};

const latestDefVersion = new Map()

// Opcode / Definition management
function addOpcode(name, code, padding = false) {
    protocolMap.name.set(name, code);
    protocolMap.code.set(code, name);
    protocolMap.padding[code] = padding;
}

Object.keys(metadata.maps.protocol).forEach(name => addOpcode(name, metadata.maps.protocol[name], hasPadding(metadata.protocolVersion, name)));

// Initialize protocol
const protocol = new parser.protocol(metadata.patchVersion, metadata.patchVersion, protocolMap);
protocol.load(dataFolder);

if (protocol.messages) {
    for (const [name, defs] of protocol.messages) {
        latestDefVersion.set(name, Math.max(...defs.keys()));
    }
}

module.exports = {
    metadata,
    protocol,
    protocolMap
};

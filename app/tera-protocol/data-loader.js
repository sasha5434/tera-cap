const config = require("config");
const path = require('path');
const fs = require('fs');

const dataFolder = path.join(__dirname, '../../', 'data');
const modFolder = path.join(__dirname, '../../', 'mods');

const metadata = {
    dataFolder,
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

module.exports = {
    dataFolder,
    modFolder,
    metadata
};

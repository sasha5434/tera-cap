const hexy = require('hexy')
const fs = require('fs');
const util = require('util');
module.exports = function PacketsLogger(mod) {
	const startTime = Date.now();
	let logC = true;
	let logS = true;
	let logRaw = false;
	let logRawUnkOnly = false;
	let logJson = false;
	let logUnk = true;
	let logUnkOnly = false;
	let logPaste = false;
	let hook = null;
	let searchExpr = null;

	let blacklist = [];

	function pad(n, l, c = '0') {
		return String(c).repeat(l).concat(n).slice(-l);
	}

	function hexDump(data) {
		if (logPaste) {
			return data.toString('hex')
		} else {
			return hexy.hexy(data, {format: "eights", offset: 4, caps: "upper", width: 32})
		}
	}

	function timestamp() {
		let today = new Date();
		return "[" + today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds() + ":" + today.getMilliseconds() + "]";
	}

	function packetArrow(incoming) {
		return incoming ? '<-' : '->'
	}
	
	function internalType(data) {
		return (data.$fake ? '[CRAFTED]	' : '') + (data.$silenced ? '[BLOCKED]	' : '') + (data.$modified ? '[EDITED]	' : '') + ( (!data.$fake && !data.$silenced && !data.$modified) ? '         	' : '')
	}

	function printUnknown(code, data, incoming, name) {
		console.log(`${timestamp()} ${packetArrow(incoming)} ${internalType(data)}    (id ${code}) ${name}\n`);
		if (logRaw) {
			console.log(hexDump(data) + '\n');
			console.log(data.toString('hex') + '\n');
		}
	}

	function loopBigIntToString(obj) {
		Object.keys(obj).forEach(key => {
			if (obj[key] && typeof obj[key] === 'object') loopBigIntToString(obj[key]);
			else if (typeof obj[key] === "bigint") obj[key] = obj[key].toString();
		});
	}

	function printKnown(name, packet, incoming, code, data, defPerhapsWrong) {
		loopBigIntToString(packet);
		let json = JSON.stringify(packet, null, 4);
		console.log(`${timestamp()} ${packetArrow(incoming)} ${internalType(data)} ${name}    (id ${code}${defPerhapsWrong ? ', DEF WRONG!!!)' : ')'}\n`)
		if (logJson) console.log(json + '\n')
		if (logRaw && (defPerhapsWrong || !logRawUnkOnly)) {
			console.log(hexDump(data) + '\n');
			console.log(data.toString('hex') + '\n');
		}
	}

	function isDefPerhapsWrong(name, packet, incoming, data) {
		if (incoming && name.slice(0, 2) === 'C_') {
			return true
		}
		if (!incoming && name.slice(0, 2) === 'S_') {
			return true
		}

		//let protocolVersion = mod.protocolVersion
		//let data2 = mod.dispatch.protocol.write(protocolVersion, name, '*', packet)
		let data2 = mod.dispatch.toRaw(name, '*', packet)
		if ((data.length != data2.length)) {
			return true
		} else {
			return false
		}
	}

	function shouldPrintKnownPacket(name, code, incoming) {
		if (logUnk && logUnkOnly) return false

		if (incoming) {
			if (!logS) return false
		} else {
			if (!logC) return false
		}

		for (let item of blacklist) {
			if (item === name) {
				return false
			}

			if (item === ('' + code)) {
				return false
			}
		}
		if (searchExpr !== null && !packetMatchesSearch(name, code)) {
			return false
		}

		return true
	}

	function shouldPrintUnknownPacket(name, code, incoming) {
		if (!logUnk) return false

		if (incoming) {
			if (!logS) return false
		} else {
			if (!logC) return false
		}

		for (let item of blacklist) {
			if (item === name) {
				return false
			}

			if (item === ('' + code)) {
				return false
			}
		}

		if (searchExpr !== null && !packetMatchesSearch('', code)) {
			return false
		}

		return true
	}

	function packetMatchesSearch(name, code) {
		if (searchExpr === ('' + code)) {
			return true
		} else {
			if (name !== '' && new RegExp(searchExpr).test(name)) {
				return true
			}
		}

		return false
	}

	hook = mod.hook('*', 'raw', {
		order: 999999,
		filter: {
			fake: null,
			silenced: null,
			modified: null
		}
	}, (code, data, incoming, fake) => {
		if (!logC && !logS) return

		//let protocolVersion = mod.protocolVersion
		let name = null
		let packet = null

		name = mod.dispatch.protocolMap.code.get(code);
		if (name === undefined) name = null;

		if (name) {
			try {
				//packet = mod.dispatch.protocol.parse(protocolVersion, code, '*', data)
				packet = mod.dispatch.fromRaw(code, '*', data)
			} catch (e) {
				packet = null
			}

			if (packet) {
				let defPerhapsWrong = isDefPerhapsWrong(name, packet, incoming, data)
				if (shouldPrintKnownPacket(name, code, incoming)) {
					printKnown(name, packet, incoming, code, data, defPerhapsWrong)
				}
			}
		}

		if (!name || !packet) {
			if (shouldPrintUnknownPacket(name, code, incoming)) {
				printUnknown(code, data, incoming, name)
			}
		}
	});
};

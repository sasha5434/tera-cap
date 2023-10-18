const path = require('path')
const util = require('util')
const binarySearch = require('binary-search')

function* iterateHooks(globalHooks = [], codeHooks = []) {
    const globalHooksIterator = globalHooks[Symbol.iterator](); // .values()
    const codeHooksIterator = codeHooks[Symbol.iterator](); // .values()

    let nextGlobalHook = globalHooksIterator.next()
    let nextCodeHook = codeHooksIterator.next()

    while (!nextGlobalHook.done || !nextCodeHook.done) {
        const globalHookGroup = nextGlobalHook.value
        const codeHookGroup = nextCodeHook.value

        if (globalHookGroup && (!codeHookGroup || globalHookGroup.order <= codeHookGroup.order)) {
            yield* globalHookGroup.hooks
            nextGlobalHook = globalHooksIterator.next()
        } else {
            yield* codeHookGroup.hooks
            nextCodeHook = codeHooksIterator.next()
        }
    }
}

function getHookName(hook) {
    const callbackName = hook.callback ? (hook.callback.name || '(anonymous)') : '<unknown>'
    const moduleName = hook.moduleName || '<unknown>'
    return `${callbackName} in ${moduleName}`
}

function getMessageName(map, identifier, version, originalName) {
    if (typeof identifier === 'string') {
        const append = (identifier !== originalName) ? ` (original: "${originalName}")` : ''
        return `${identifier}<${version}>${append}`
    }

    if (typeof identifier === 'number') {
        const name = map.code.get(identifier) || `(opcode ${identifier})`
        return `${name}<${version}>`
    }

    return '(?)'
}

function parseStack(err) {
    const stack = (err && err.stack) || ''
    return stack.split('\n').slice(1).map((line) => {
        if (line.indexOf('(eval ') !== -1) {
            // throw away eval info
            // see <https://github.com/stacktracejs/error-stack-parser/blob/d9eb56a/error-stack-parser.js#L59>
            line = line.replace(/(\(eval at [^()]*)|(\),.*$)/g, '')
        }

        const match = line.match(/^\s*at (?:.+\s+\()?(?:(.+):\d+:\d+|([^)]+))\)?/)
        return match && {
            filename: match[2] || match[1],
            source: line,
        }
    }).filter(Boolean)
}

function errStack(err = new Error(), removeFront = true) {
    const stack = parseStack(err)
    const libPath = /tera-network-proxy[\\/]lib/

    // remove node internals from end
    while (stack.length > 0 && !path.isAbsolute(stack[stack.length - 1].filename)) {
        stack.pop()
    }

    // remove tera-network-proxy internals from end
    while (stack.length > 0 && libPath.test(stack[stack.length - 1].filename)) {
        stack.pop()
    }

    if (removeFront) {
        // remove tera-network-proxy internals from front
        while (stack.length > 0 && libPath.test(stack[0].filename)) {
            stack.shift()
        }
    }

    return stack.map(frame => frame.source).join('\n')
}

// -----------------------------------------------------------------------------

class Dispatch {
    constructor(connection) {
        this.variables = connection.variables
        this.protocol = connection.protocol
        this.protocolMap = connection.protocolMap
        this.hooks = new Map()
        this.userinfo = connection.userinfo
    }

    fromRaw(name, version, data) {
        return this.protocol.parse(this.protocol.resolveIdentifier(name, version), data);
    }

    toRaw(name, version, data) {
        return this.protocol.write(this.protocol.resolveIdentifier(name, version), data);
    }

    resolve(name, definitionVersion = '*') {
        return this.protocol.resolveIdentifier(name, definitionVersion);
    }

    createHook(moduleName, name, version, opts, cb) {
        // parse args
        if (typeof version !== 'number' && version !== '*' && version !== 'raw' && version !== 'event')
            throw TypeError(`[dispatch] [${moduleName}] hook: invalid version specified (${version})`);

        if (opts && typeof opts !== 'object') {
            cb = opts;
            opts = {};
        }

        if (typeof cb !== 'function')
            throw TypeError(`[dispatch] [${moduleName}] hook: last argument not a function (given: ${typeof cb})`);

        // retrieve opcode
        let code;
        let resolvedIdentifier;
        if (name === '*') {
            code = name;
            if (typeof version === 'number')
                throw TypeError(`[dispatch] [${moduleName}] hook: * hook must request version '*', 'raw', or 'event' (given: ${version})`);
        } else {
            // Check if opcode is mapped
            code = this.protocolMap.name.get(name);
            if (code === null || typeof code === 'undefined')
                throw Error(`[dispatch] [${moduleName}] hook: unmapped packet "${name}"`);

            // Check if definition exists / is deprecated
            if (version !== 'raw' && version !== 'event') {
                try {
                    resolvedIdentifier = this.resolve(name, version);
                    if (!resolvedIdentifier.definition.readable)
                        throw Error(`obsolete definition (${name}.${version})`);
                    else if (!resolvedIdentifier.definition.writeable)
                        log.warn(`[dispatch] [${moduleName}] hook: deprecated definition (${name}.${version}), mod might be broken!`);
                } catch (e) {
                    throw Error(`[dispatch] [${moduleName}] hook: ${e}`);
                }
            }
        }

        // create hook
        return {
            moduleName,
            code,
            filter: Object.assign({ fake: false, incoming: null, modified: null, silenced: false }, opts.filter),
            order: opts.order || 0,
            definitionVersion: version,
            callback: cb,
            name,
            resolvedIdentifier
        };
    }

    addHook(hook) {
        const { code, order } = hook;

        if (!this.hooks.has(code))
            this.hooks.set(code, []);

        const ordering = this.hooks.get(code);
        const index = binarySearch(ordering, { order }, (a, b) => a.order - b.order);
        if (index < 0) {
            // eslint-disable-next-line no-bitwise
            ordering.splice(~index, 0, { order, hooks: [hook] });
        } else {
            ordering[index].hooks.push(hook);
        }
    }

    hook(...args) {
        const hook = this.createHook(...args);
        this.addHook(hook);
        return hook;
    }

    handle(data, incoming, fake = false) {
        const code = data.readUInt16LE(2)

        const globalHooks = this.hooks.get('*')
        const codeHooks = this.hooks.get(code)
        if (!globalHooks && !codeHooks) return data

        let modified = false
        let silenced = false

        let eventCache = [],
            iter = 0,
            hooks = (globalHooks ? globalHooks.length : 0) + (codeHooks ? codeHooks.length : 0) // TODO bug

        for (const hook of iterateHooks(globalHooks, codeHooks)) {
            const lastHook = false; // quick workaround for bug above

            // check flags
            const { filter } = hook
            if (filter.fake !== null && filter.fake !== fake) continue
            if (filter.incoming !== null && filter.incoming !== incoming) continue
            if (filter.modified !== null && filter.modified !== modified) continue
            if (filter.silenced !== null && filter.silenced !== silenced) continue

            if (hook.definitionVersion === 'raw') {
                try {
                    const copy = Buffer.from(data)
                    Object.defineProperties(copy, {
                        $fake: { value: fake },
                        $incoming: { value: incoming },
                        $modified: { value: modified },
                        $silenced: { value: silenced },
                    })

                    const result = hook.callback(code, copy, incoming, fake)

                    if (Buffer.isBuffer(result)) {
                        if (result.length !== data.length || !result.equals(data)) {
                            modified = true
                            eventCache = []
                            data = result
                        }
                    } else if (typeof result === 'boolean') {
                        silenced = !result
                    }
                }
                catch (e) {
                    console.error([
                        `[dispatch] [${hook.moduleName}] handle: error running raw hook for ${getMessageName(this.protocolMap, code, hook.definitionVersion)}`,
                        `hook: ${getHookName(hook)}`,
                        `data: ${data.toString('hex')}`,
                        `error: ${e.message}`,
                        errStack(e),
                    ].join('\n'))
                }
            } else if (hook.definitionVersion === 'event') {
                try {
                    const result = hook.callback()

                    if (result === false)
                        silenced = true
                }
                catch (e) {
                    console.log([
                        `[dispatch] [${hook.moduleName}] handle: error running event hook for ${getMessageName(this.protocolMap, code, hook.definitionVersion)}`,
                        `hook: ${getHookName(hook)}`,
                        `error: ${e.message}`,
                        errStack(e),
                    ].join('\n'))
                }
            } else { // normal hook
                try {
                    const defVersion = hook.definitionVersion
                    const resolvedIdentifier = hook.resolvedIdentifier
                    let event = eventCache[defVersion] || (eventCache[defVersion] = this.protocol.parse(resolvedIdentifier, data))
                    if (!lastHook)
                        event = this.protocol.clone(resolvedIdentifier, event)

                    Object.defineProperties(event, {
                        $fake: { value: fake },
                        $incoming: { value: incoming },
                        $modified: { value: modified },
                        $silenced: { value: silenced },
                    })

                    try {
                        const result = hook.callback(event, fake)

                        if (result === true) {
                            eventCache = []

                            try {
                                data = this.protocol.write(resolvedIdentifier, event)

                                modified = true
                                silenced = false
                            } catch (e) {
                                console.log([
                                    `[dispatch] [${hook.moduleName}] handle: failed to generate ${getMessageName(this.protocolMap, code, defVersion)}`,
                                    `hook: ${getHookName(hook)}`,
                                    `error: ${e.message}`,
                                    errStack(e, false),
                                ].join('\n'))
                            }
                        }
                        else if (result === false)
                            silenced = true
                    }
                    catch (e) {
                        console.log([
                            `[dispatch] [${hook.moduleName}] handle: error running hook for ${getMessageName(this.protocolMap, code, defVersion)}`,
                            `hook: ${getHookName(hook)}`,
                            `data: ${util.inspect(event)}`,
                            `error: ${e.message}`,
                            errStack(e),
                        ].join('\n'))
                    }
                }
                catch (e) {
                    console.log([
                        `[dispatch] [${hook.moduleName}] handle: failed to parse ${getMessageName(this.protocolMap, code, hook.definitionVersion)}`,
                        `hook: ${getHookName(hook)}`,
                        `data: ${data.toString('hex')}`,
                        `error: ${e.message}`,
                        errStack(e, false),
                    ].join('\n'))
                }
            }
        }

        // return value
        return (!silenced ? data : false)
    }

    // Opcode / Definition management

}

module.exports = Dispatch;

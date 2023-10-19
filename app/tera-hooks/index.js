const logger = require('./hooks/logger');
const online = require('./hooks/online');
const chat = require('./hooks/chat');
const matching = require('./hooks/matching');

function hooks (dispatch) {
    function hook(...args) {
        const hook = dispatch.hook(null, ...args);
        return hook;
    }
    const mod = { hook,dispatch }
    //logger(mod)
    online(mod)
    chat(mod)
    matching(mod)
}

module['exports'] = hooks
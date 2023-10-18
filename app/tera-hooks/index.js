const logger = require('./hooks/logger');
const online = require('./hooks/online');
const chat = require('./hooks/chat');

function hooks (dispatch) {
    function hook(...args) {
        const hook = dispatch.hook(null, ...args);
        return hook;
    }
    const mod = { hook,dispatch }
    //logger(mod)
    online(mod)
    chat(mod)
}

module['exports'] = hooks
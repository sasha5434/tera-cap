const logger = require('./hooks/logger');
const login = require('./hooks/login');

function hooks (dispatch) {
    function hook(...args) {
        const hook = dispatch.hook(null, ...args);
        return hook;
    }
    const mod = { hook,dispatch }
    //logger(mod)
    login(mod)
}

module['exports'] = hooks
const logger = require('./hooks/logger');

function hooks (dispatch) {
    function hook(...args) {
        const hook = dispatch.hook(null, ...args);
        return hook;
    }
    const mod = {
        hook,
        dispatch
    }
    logger(mod)
}

module['exports'] = hooks
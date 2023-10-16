const colors = require("colors")
module.exports = function login(mod) {
    mod.hook('S_LOGIN_ACCOUNT_INFO', 2, event => {
        mod.dispatch.userinfo.id = parseInt(event.accountId, 10);
        mod.dispatch.userinfo.server = event.serverName
    });

    mod.hook('S_GET_USER_LIST', 17, (event) => {
        mod.dispatch.userinfo.inGame = false;
        for (const key of Object.keys(event.characters)){
            mod.dispatch.userinfo.characters[event.characters[key].id] = {
                gender: event.characters[key].gender,
                race: event.characters[key].race,
                class: event.characters[key].class
            }
        }
    });

    mod.hook('S_RETURN_TO_LOBBY', 'event', () => { mod.dispatch.userinfo.inGame = false; });
    mod.hook('S_EXIT', 'event', () => { mod.dispatch.userinfo.inGame = false; });

    mod.hook('S_LOGIN', 14, (event) => {
        mod.dispatch.userinfo.inGame = true;
        mod.dispatch.userinfo.character.gameId = parseInt(event.gameId, 10);
        mod.dispatch.userinfo.character.id = parseInt(event.playerId, 10);
        mod.dispatch.userinfo.character.name = event.name;
        mod.dispatch.userinfo.character.level = parseInt(event.level, 10);
        console.log(colors.blue('[tera-hooks/hooks/login] - Enter world - id: ' + event.playerId + ', name: ' + event.name + ', level: ' + event.level));
    });

    mod.hook('S_USER_CHANGE_NAME', 1, (event) => { if (mod.dispatch.userinfo.character.gameId === parseInt(event.gameId, 10)) mod.dispatch.userinfo.character.name = event.name })
    mod.hook('S_USER_LEVELUP', 2, (event) => { if (mod.dispatch.userinfo.character.gameId === parseInt(event.gameId, 10)) mod.dispatch.userinfo.character.level = parseInt(event.level, 10) })
}
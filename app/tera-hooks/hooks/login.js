module.exports = function login(mod) {
    hook = mod.hook('S_LOGIN', 14, (event) => {
        console.log('Enter world - id: ' + event.playerId + ' name: ' + event.name + ' level: ' + event.level);
    });
}
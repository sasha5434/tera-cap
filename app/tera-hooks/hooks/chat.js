const fs = require('fs');
const colors = require("colors")
const moment = require("moment")
module.exports = function chat(mod) {
    mod.hook('C_CHAT', 1, event => {
        const date = moment(Date.now()).local().format('DD/MM/YYYY H:mm:ss')
        console.log(colors.cyan(date + ' ' + mod.dispatch.userinfo.character.name + ', ch: ' + event.channel + ' msg: ' + event.message.replace(/<\/?[^>]+>/gi, '')))
        fs.appendFileSync('chat.txt', date + ' ' + mod.dispatch.userinfo.character.name + ', ch: ' + event.channel + ' msg: ' + event.message.replace(/<\/?[^>]+>/gi, '') + '\n')
    });
}
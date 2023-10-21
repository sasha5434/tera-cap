const colors = require("colors")
const { Matching } = require('../../models/matching')

module.exports = function matching(mod) {
    mod.hook('S_ADD_INTER_PARTY_MATCH_POOL', 1, event => {

        if (mod.dispatch.userinfo.character.name !== event.players[0].name)
            return;

        console.log(colors.blue(`[tera-hooks/hooks/matching] - Matching added: [${event.instances}] - [${Object.values(event.players).map(p => p.name)}]`));

        const matching = new Matching(event.instances, event.players);
        if (event.matchingType === 0)
            mod.dispatch.variables.dungeons.add(matching);
        else if (event.matchingType === 1)
            mod.dispatch.variables.battlegrounds.add(matching);
    });
    
    mod.hook('S_DEL_INTER_PARTY_MATCH_POOL', 1, event => {

        const name = mod.dispatch.userinfo.character.name;
        let removed = false;
        if (event.matchingType === 0)
            removed = mod.dispatch.variables.dungeons.tryRemoveByPlayerName(name);
        else if (event.matchingType === 1)
            removed = mod.dispatch.variables.battlegrounds.tryRemoveByPlayerName(name);
        else {
            removed = mod.dispatch.variables.dungeons.tryRemoveByPlayerName(name);
            removed |= mod.dispatch.variables.battlegrounds.tryRemoveByPlayerName(name);
        }

        if (removed)
            console.log(colors.blue(`[tera-hooks/hooks/matching] - Matching removed: by "${name}"`));
    });

    mod.hook('S_MODIFY_INTER_PARTY_MATCH_POOL', 1, event => {
        
        const name = mod.dispatch.userinfo.character.name;
        if (name !== event.players[0].name)
            return;

        const modified = mod.dispatch.variables.dungeons.tryModifyByPlayerName(name, event.players);
        if (!modified)
            console.log(colors.red(`[tera-hooks/hooks/matching] - Could not modify matching: by "${name}"`));
        else
            console.log(colors.blue(`[tera-hooks/hooks/matching] - Matching modified: by "${name}"`));
    });
}
class Matching {
    constructor(instances, players) {
        this.instances = instances; // array of int32
        this.players = players; // array of objs {name: string, role: int32, isLeader: bool}
        this.isLinked = false; // if level and class props was added to players objs (linked with connection.character)
    }
}

class Matchings {
    constructor() {
        this.matchingList = []; // array of Matching
    }

    add(matching) {
        this.matchingList.push(matching);
    }

    tryRemoveByPlayerName(name) {
        const id = this.matchingList.findIndex(m => m.players.some(p => p.name === name));
        if (id === -1)
            return false;

        this.matchingList.splice(id, 1);
        return true;
    }

    tryModifyByPlayerName(name, newPlayers) {
        const matching = this.matchingList.find(m => m.players.some(p => p.name === name));
        if (matching === undefined)
            return false;

        matching.players = newPlayers;
        return true;
    }

    link(sessions) { // links players from matchings with player from sessions by name
        if (this.matchingList.length === 0)
            return;

        this.matchingList.filter(m => !m.isLinked).forEach(m => {
            m.players.forEach(p => {
                const session = Object.values(sessions).find(s => s.connection.userinfo.character.name === p.name);
                const id = session.connection.userinfo.character.id;
                p.level = session.connection.userinfo.character.level;
                p.class = session.connection.userinfo.characters[id].class;
            });
            m.isLinked = true;
        })
    }

    getGroupedByInstance() { // return array of { id: int32, parties: array }
        if (this.matchingList.length === 0)
            return [];

        const temp = this.matchingList.flatMap(m => m.instances.map(i => { return { instance: i, players: m.players } }));
        return Object.entries(this.#groupBy(temp, "instance")).
            map(([ key, value ]) => { return { id: key, parties: value.map(v => { return { players: v.players } }) } });
    }

    #groupBy(xs, key) { // https://stackoverflow.com/questions/14446511/
        return xs.reduce(function(rv, x) {
            (rv[x[key]] = rv[x[key]] || []).push(x);
            return rv;
        }, {});
    }
}

module['exports'] = {
    Matching, Matchings
}
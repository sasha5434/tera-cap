const colors = require("colors")
class Matching {
    constructor(instances, players) {
        this.instances = instances; // array of int32
        this.players = players; // array of objs {name: string, role: int32, isLeader: bool}
        this.isLinked = false; // if level and class props was added to players objs (linked with connection.character)
        this.removeRequestCounter = players.length - 2; // temp solution for simultaneous DEL and MODIFY messages
        this.removeRequestNames = [];
    }
}

class Matchings {
    constructor() {
        this.matchingList = []; // array of Matching
    }

    add(matching) {
        this.#checkDuplicates(matching.players);
        this.matchingList.push(matching);
    }

    tryRemoveByPlayerName(name) {
        const matching = this.matchingList.find(m => m.players.filter(p => !m.removeRequestNames.includes(p.name)).some(p => p.name === name));
        if (matching === undefined)
            return false;

        if (--matching.removeRequestCounter >= 0) {
            matching.removeRequestNames.push(name);
            return false;
        }
        return this.#remove(matching);
    }

    tryModifyByPlayerName(name, newPlayers) {
        const matching = this.matchingList.find(m => m.players.filter(p => !m.removeRequestNames.includes(p.name)).some(p => p.name === name));
        if (matching === undefined)
            return false;

        matching.players = newPlayers;
        matching.removeRequestCounter = newPlayers.length - 2;
        matching.removeRequestNames = [];
        return true;
    }

    link(sessions) { // links players from matchings with player from sessions by name
        if (this.matchingList.length === 0)
            return;

        this.matchingList.filter(m => !m.isLinked).forEach(m => {
            m.players.forEach(p => {
                const session = Object.values(sessions).find(s => s.connection?.userinfo?.character?.name === p.name);
                if (session === undefined) {
                    p.level = null;
                    p.class = null;
                }
                else {
                    const id = session.connection.userinfo.character.id;
                    p.level = session.connection.userinfo.character.level;
                    p.class = session.connection.userinfo.characters[id].class;
                }
            });
            m.isLinked = true;
        });
    }

    getGroupedByInstance() { // return array of { id: int32, parties: array }
        this.#checkOutdated();

        if (this.matchingList.length === 0)
            return [];

        const temp = this.matchingList.flatMap(m => m.instances.map(i => { return { instance: i, players: m.players } }));
        return Object.entries(this.#groupBy(temp, "instance")).
            map(([ key, value ]) => { return { id: key, parties: value.map(v => { return { players: v.players } }) } });
    }

    #remove(matching) {
        const id = this.matchingList.indexOf(matching);
        if (id === -1)
            return false;

        this.matchingList.splice(id, 1);
        return true;
    }

    #groupBy(xs, key) { // https://stackoverflow.com/questions/14446511/
        return xs.reduce(function(rv, x) {
            (rv[x[key]] = rv[x[key]] || []).push(x);
            return rv;
        }, {});
    }

    #checkOutdated() { // temp solution for removing outdated matchings from matchingList
        if (this.matchingList.length === 0)
            return;

        const forRemoving = [];

        this.matchingList.filter(m => m.isLinked && m.removeRequestNames.length > 0).forEach(m => {
            const flag = m.players.filter(p => !m.removeRequestNames.includes(p.name)).every(p => p.level === null && p.class === null);
            if (flag)
                forRemoving.push(m);
        });

        if (forRemoving.length > 0) {
            forRemoving.forEach(m => this.#remove(m));
            console.log(colors.yellow(`[models/matching] - Deleted outdated matchings: "${forRemoving.length}"`));
        }
    }

    #checkDuplicates(players) { // temp solution for removing duplicate matchings from matchingList
        const forRemoving = this.matchingList.filter(m => m.players.some(p => players.includes(p)));
        if (forRemoving.length > 0) {
            forRemoving.forEach(m => this.#remove(m));
            console.log(colors.yellow(`[models/matching] - Deleted duplicate matchings: "${forRemoving.length}"`));
        }
    }
}

module['exports'] = {
    Matching, Matchings
}
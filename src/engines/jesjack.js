// jesjack engine: motor de colocación escrito desde cero, alternativo a main engine (src/layout/).
// Se elige con layoutDiagram(graph, { engine: "jesjack" }); el adaptador está en src/layout.js.
//
// Entra (crudo, sin lados):
//   { nodes: [{ id, bus? }], connections: [{ index, from, to }] }
//   - bus: solo en los empalmes elegidos con "%% @bus X === A"; id del nodo al que se une (A),
//     que puede ser a su vez otro empalme. La conexión entre ambos viene en connections.
// Sale:
//   { nodes: [{ id, x, y, junctionOf? }], connections: [{ index?, from, to }] }
//   - x, y: celda de la rejilla (columna, fila), no píxeles.
//   - junctionOf: solo en los empalmes (los de @bus y los que cree el motor); id del nodo dueño,
//     el primero de la cadena de bus que no es empalme.
//   - una conexión con index es la original con ese index (sus extremos pueden ser ya empalmes);
//     sin index, un tramo nuevo entre un nodo y su empalme.
//   - el orden de nodes es el del paso a paso del visor.

(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.JesjackEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {

// Las cuatro salidas de un nodo, en el orden en que se prueban, con su desplazamiento
// en la rejilla respecto al nodo y la salida opuesta.
const SIDES = {
    up: { dx: 0, dy: -1, opposite: "down" },
    down: { dx: 0, dy: 1, opposite: "up" },
    left: { dx: -1, dy: 0, opposite: "right" },
    right: { dx: 1, dy: 0, opposite: "left" },
};

// Salida de un nodo: no guarda posición propia, la deriva del padre; moverla mueve al padre.
class Exit {
    constructor(parent, side) {
        // No enumerable para que JSON.stringify no entre en ciclo.
        Object.defineProperty(this, "parent", { value: parent });
        this.side = side;
        this.to = null; // id del nodo unido por esta salida; null si está libre
    }
    get x() { return this.parent.x + SIDES[this.side].dx; }
    set x(v) { this.parent.x = v - SIDES[this.side].dx; }
    get y() { return this.parent.y + SIDES[this.side].dy; }
    set y(v) { this.parent.y = v - SIDES[this.side].dy; }
    get opposite() { return SIDES[this.side].opposite; }
}

// Nodo del grafo de salida: id, celda (x, y) y sus salidas up, down, left, right.
class GraphNode {
    constructor(id, x = 0, y = 0) {
        this.id = id;
        this.x = x;
        this.y = y;
        for (const side in SIDES) this[side] = new Exit(this, side);
    }
    get exits() { return Object.keys(SIDES).map(side => this[side]); }
}

// Grafo de entrada: los datos crudos por id, con las conexiones que salen y entran de cada nodo.
class InputGraph {
    constructor({ nodes, connections }) {
        this.nodes = new Map();
        for (const { id, bus } of nodes) this.nodes.set(id, { id, bus, out: [], in: [] });
        for (const c of connections) {
            this.get(c.from).out.push(c);
            this.get(c.to).in.push(c);
        }
    }
    get(id) { return this.nodes.get(id); }

    // Dueño de un empalme de @bus: sigue la cadena de bus hasta un nodo que no es empalme.
    ownerOf(id) {
        let bus = this.get(id).bus;
        while (this.get(bus).bus !== undefined) bus = this.get(bus).bus;
        return bus;
    }
}

// Grafo de salida: nodos colocados en la rejilla, a lo sumo uno por celda.
class OutputGraph {
    constructor(input) {
        this.input = input; // grafo de entrada, para leer bus
        this.nodes = new Map();
    }
    get(id) { return this.nodes.get(id); }

    // Nodo que ocupa la celda (x, y), o undefined.
    at(x, y) {
        for (const node of this.nodes.values()) if (node.x === x && node.y === y) return node;
    }

    // Coloca un nodo suelto en la celda (x, y).
    add(id, x = 0, y = 0) {
        if (this.nodes.has(id)) throw new Error(`Node "${id}" is already in the graph.`);
        const other = this.at(x, y);
        if (other) throw new Error(`Cell (${x}, ${y}) is already taken by "${other.id}".`);
        const node = new GraphNode(id, x, y);
        this.nodes.set(id, node);
        return node;
    }

    // Coloca un nodo en la primera salida libre del nodo parentId (up, down, left, right):
    // la salida no debe estar unida a otro nodo ni su celda ocupada. Une ambas salidas.
    // Si el nodo es un empalme de @bus, su bus pasa a junctionOf (el dueño de la cadena).
    addTo(parentId, id) {
        const parent = this.get(parentId);
        if (!parent) throw new Error(`Node "${parentId}" is not in the graph.`);
        const exit = parent.exits.find(e => e.to === null && !this.at(e.x, e.y));
        if (!exit) throw new Error(`Node "${parentId}" has no free exit for "${id}".`);
        const node = this.add(id, exit.x, exit.y);
        exit.to = id;
        node[exit.opposite].to = parentId;
        if (this.input.get(id)?.bus !== undefined) node.junctionOf = this.input.ownerOf(id);
        return node;
    }

    // Salida del engine (contrato al inicio del archivo): nodos en orden de colocación, con las
    // celdas desplazadas para que la menor sea 0, y las conexiones originales.
    toResult(connections) {
        const placed = [...this.nodes.values()];
        const minX = Math.min(0, ...placed.map(n => n.x));
        const minY = Math.min(0, ...placed.map(n => n.y));
        return {
            nodes: placed.map(n => {
                const o = { id: n.id, x: n.x - minX, y: n.y - minY };
                if (n.junctionOf !== undefined) o.junctionOf = n.junctionOf;
                return o;
            }),
            connections: connections.map(({ index, from, to }) => ({ index, from, to })),
        };
    }
}

function jesjackEngine({ nodes, connections }) {

    const input = new InputGraph({ nodes, connections });
    const output = new OutputGraph(input);

    for (const node of input.nodes.values()) {
        for (const c of node.out) {
            const fromNode = output.get(c.from) || output.add(c.from);
            const toNode = output.get(c.to) || output.addTo(c.from, c.to);
        }
        if (!output.get(node.id)) {
            let x = 0, y = 0;
            while (output.at(x, y)) { x++ }
            output.add(node.id, x, y);
        }
    }

    return output.toResult(connections);

}

return { jesjackEngine, InputGraph, OutputGraph, GraphNode, Exit };
});

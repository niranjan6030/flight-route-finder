// routing.js
// All the route finding code is in this file. The page (app.js), the tests (tests.js)
// and the experiments (benchmark.js) use these same functions.
//
// The network is a graph. Airports are the nodes and are numbered 0, 1, 2, ...
//   net.n        number of airports
//   net.to[u]    list of airports you can fly to from airport u
//   net.km[u]    net.km[u][i] is the distance in km of the flight from u to net.to[u][i]
//   net.lat, net.lon   position of every airport (only needed by A*)
//
// What "best" means is decided by a cost. Every flight costs
//       a * km + b
//   shortest distance:  a = 1,     b = 0             cost is km
//   quickest:           a = 1/800, b = 0.5 + wait    cost is hours
//   fewest flights:     a = 0.000001, b = 1          cost is the number of flights,
//                                                    the tiny km part only decides between equal ones
// All costs are positive numbers, which is what Dijkstra's algorithm needs.

var SPEED = 800;        // average speed of a passenger jet in km per hour
var GROUND = 0.5;       // hours added to every flight for taxi, take off and landing

// wait = hours spent in the airport between two flights (only used by "time")
function costFor(mode, wait) {
  if (mode === "km") return { a: 1, b: 0, unit: "km" };
  if (mode === "flights") return { a: 0.000001, b: 1, unit: "flights" };
  // "time": the wait is added to every flight. A trip with k flights has k - 1 waits,
  // so I take one wait off again at the end (see tripHours). The order of the routes stays the same.
  return { a: 1 / SPEED, b: GROUND + wait, unit: "hours" };
}

// distance between two points on the globe in km (haversine formula)
function greatCircleKm(lat1, lon1, lat2, lon2) {
  var R = 6371;
  var p = Math.PI / 180;
  var x = Math.sin((lat2 - lat1) * p / 2) * Math.sin((lat2 - lat1) * p / 2) +
          Math.cos(lat1 * p) * Math.cos(lat2 * p) *
          Math.sin((lon2 - lon1) * p / 2) * Math.sin((lon2 - lon1) * p / 2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

// hours in the air for one flight
function flightHours(km) {
  return km / SPEED + GROUND;
}

// Builds the network from the two lists in data/network.js
function buildNetwork(airports, routes) {
  var net = { n: airports.length, to: [], km: [], lat: [], lon: [] };
  for (var i = 0; i < airports.length; i++) {
    net.lat.push(airports[i][4]);
    net.lon.push(airports[i][5]);
  }
  for (var u = 0; u < airports.length; u++) {
    var dist = [];
    for (var k = 0; k < routes[u].length; k++) {
      var v = routes[u][k];
      dist.push(greatCircleKm(net.lat[u], net.lon[u], net.lat[v], net.lon[v]));
    }
    net.to.push(routes[u]);
    net.km.push(dist);
  }
  return net;
}

// Builds a small network by hand. flights = [[from, to, km], ...] and every flight is one way.
function makeNetwork(n, flights) {
  var net = { n: n, to: [], km: [] };
  for (var i = 0; i < n; i++) { net.to.push([]); net.km.push([]); }
  for (var f = 0; f < flights.length; f++) {
    net.to[flights[f][0]].push(flights[f][1]);
    net.km[flights[f][0]].push(flights[f][2]);
  }
  return net;
}


// ---------- Min-heap (priority queue) ----------
// Keeps (airport, cost) pairs so that the one with the smallest cost can be taken out quickly.
// It is a binary tree stored in an array: the children of position i are at 2i+1 and 2i+2.
// push and pop both take O(log n).
function MinHeap() {
  this.node = [];
  this.cost = [];
}

MinHeap.prototype.size = function () { return this.node.length; };

MinHeap.prototype.swap = function (i, j) {
  var n = this.node[i]; this.node[i] = this.node[j]; this.node[j] = n;
  var c = this.cost[i]; this.cost[i] = this.cost[j]; this.cost[j] = c;
};

MinHeap.prototype.push = function (node, cost) {
  this.node.push(node);
  this.cost.push(cost);
  // move the new item up while it is smaller than its parent
  var i = this.node.length - 1;
  while (i > 0) {
    var parent = (i - 1) >> 1;
    if (this.cost[parent] <= this.cost[i]) break;
    this.swap(i, parent);
    i = parent;
  }
};

// removes the item with the smallest cost and gives it back
MinHeap.prototype.pop = function () {
  var top = { node: this.node[0], cost: this.cost[0] };
  var lastNode = this.node.pop();
  var lastCost = this.cost.pop();
  if (this.node.length > 0) {
    // put the last item on top and move it down while a child is smaller
    this.node[0] = lastNode;
    this.cost[0] = lastCost;
    var i = 0;
    while (true) {
      var left = 2 * i + 1, right = 2 * i + 2, small = i;
      if (left < this.node.length && this.cost[left] < this.cost[small]) small = left;
      if (right < this.node.length && this.cost[right] < this.cost[small]) small = right;
      if (small === i) break;
      this.swap(i, small);
      i = small;
    }
  }
  return top;
};


// walks back from the destination using the "came from" list and returns the route
function buildPath(prev, src, dst) {
  var path = [dst];
  while (path[0] !== src) path.unshift(prev[path[0]]);
  return path;
}

function emptyAnswer(extra) {
  var r = { path: null, cost: Infinity, settled: 0, checked: 0, heapMax: 0, order: [] };
  for (var k in extra) r[k] = extra[k];
  return r;
}


// ---------- 1. Dijkstra's algorithm with a min-heap (the one the page uses) ----------
// closed[u] = true means airport u cannot be used.
// Returns  path     list of airports from src to dst, or null if there is no way
//          cost     total cost of that path
//          settled  how many airports were finished (their best cost is final)
//          checked  how many flights were looked at
//          heapMax  the most items that were in the heap at one time
//          order    the airports in the order they were finished (to draw them on the map)
function dijkstra(net, src, dst, cost, closed) {
  closed = closed || [];
  if (closed[src] || closed[dst]) return emptyAnswer();

  var best = [], prev = [], done = [];
  for (var i = 0; i < net.n; i++) { best.push(Infinity); prev.push(-1); done.push(false); }

  var heap = new MinHeap();
  best[src] = 0;
  heap.push(src, 0);
  var settled = 0, checked = 0, heapMax = 1, order = [];

  while (heap.size() > 0) {
    var top = heap.pop();
    var u = top.node;
    if (done[u]) continue;            // an older, worse copy of u that was still in the heap
    done[u] = true;
    settled++;
    order.push(u);
    if (u === dst) break;             // the destination is final, no need to finish the rest

    var to = net.to[u], km = net.km[u];
    for (var k = 0; k < to.length; k++) {
      var v = to[k];
      if (done[v] || closed[v]) continue;
      checked++;
      var c = best[u] + cost.a * km[k] + cost.b;
      if (c < best[v]) {              // found a better way to reach v
        best[v] = c;
        prev[v] = u;
        heap.push(v, c);
        if (heap.size() > heapMax) heapMax = heap.size();
      }
    }
  }

  if (!done[dst]) return emptyAnswer({ settled: settled, checked: checked, heapMax: heapMax, order: order });
  return { path: buildPath(prev, src, dst), cost: best[dst], settled: settled, checked: checked, heapMax: heapMax, order: order };
}


// ---------- 2. Dijkstra without a heap ----------
// The simple version from the textbook: to find the closest airport that is not done yet
// it looks through all of them. O(V^2). Only used to compare in the experiments.
function dijkstraSimple(net, src, dst, cost, closed) {
  closed = closed || [];
  if (closed[src] || closed[dst]) return emptyAnswer();

  var best = [], prev = [], done = [];
  for (var i = 0; i < net.n; i++) { best.push(Infinity); prev.push(-1); done.push(false); }
  best[src] = 0;
  var settled = 0, checked = 0;

  while (true) {
    var u = -1;
    for (var j = 0; j < net.n; j++) {
      if (!done[j] && best[j] < Infinity && (u === -1 || best[j] < best[u])) u = j;
    }
    if (u === -1) break;              // nothing left that can be reached
    done[u] = true;
    settled++;
    if (u === dst) break;

    var to = net.to[u], km = net.km[u];
    for (var k = 0; k < to.length; k++) {
      var v = to[k];
      if (done[v] || closed[v]) continue;
      checked++;
      var c = best[u] + cost.a * km[k] + cost.b;
      if (c < best[v]) { best[v] = c; prev[v] = u; }
    }
  }

  if (!done[dst]) return emptyAnswer({ settled: settled, checked: checked });
  return { path: buildPath(prev, src, dst), cost: best[dst], settled: settled, checked: checked, heapMax: 0, order: [] };
}


// ---------- 3. A* search ----------
// Same as Dijkstra, but the heap is ordered by (cost so far + a guess of the cost still to go).
// The guess for airport u is the cost of one direct flight from u to the destination.
// No real route can be cheaper than that, so the answer is still the best one.
function guess(net, u, dst, cost) {
  if (u === dst) return 0;
  if (!net.lat) return 0;       // a network typed by hand has no positions. No guess, so it works like Dijkstra
  return cost.a * greatCircleKm(net.lat[u], net.lon[u], net.lat[dst], net.lon[dst]) + cost.b;
}

function aStar(net, src, dst, cost, closed) {
  closed = closed || [];
  if (closed[src] || closed[dst]) return emptyAnswer();

  var best = [], prev = [], done = [];
  for (var i = 0; i < net.n; i++) { best.push(Infinity); prev.push(-1); done.push(false); }

  var heap = new MinHeap();
  best[src] = 0;
  heap.push(src, guess(net, src, dst, cost));
  var settled = 0, checked = 0, heapMax = 1, order = [];

  while (heap.size() > 0) {
    var u = heap.pop().node;
    if (done[u]) continue;
    done[u] = true;
    settled++;
    order.push(u);
    if (u === dst) break;

    var to = net.to[u], km = net.km[u];
    for (var k = 0; k < to.length; k++) {
      var v = to[k];
      if (done[v] || closed[v]) continue;
      checked++;
      var c = best[u] + cost.a * km[k] + cost.b;
      if (c < best[v]) {
        best[v] = c;
        prev[v] = u;
        heap.push(v, c + guess(net, v, dst, cost));
        if (heap.size() > heapMax) heapMax = heap.size();
      }
    }
  }

  if (!done[dst]) return emptyAnswer({ settled: settled, checked: checked, heapMax: heapMax, order: order });
  return { path: buildPath(prev, src, dst), cost: best[dst], settled: settled, checked: checked, heapMax: heapMax, order: order };
}


// ---------- 4. Breadth first search ----------
// Goes outwards one flight at a time, so it finds a route with the fewest flights.
// It does not look at km at all. O(V + E).
function bfs(net, src, dst, closed) {
  closed = closed || [];
  if (closed[src] || closed[dst]) return emptyAnswer({ flights: -1 });

  var prev = [], seen = [];
  for (var i = 0; i < net.n; i++) { prev.push(-1); seen.push(false); }
  var queue = [src];
  seen[src] = true;
  var head = 0, checked = 0;

  while (head < queue.length) {
    var u = queue[head++];
    if (u === dst) break;
    var to = net.to[u];
    for (var k = 0; k < to.length; k++) {
      var v = to[k];
      checked++;
      if (seen[v] || closed[v]) continue;
      seen[v] = true;
      prev[v] = u;
      queue.push(v);
    }
  }

  if (!seen[dst]) return emptyAnswer({ flights: -1, settled: head, checked: checked });
  var path = buildPath(prev, src, dst);
  return { path: path, flights: path.length - 1, settled: head, checked: checked, heapMax: queue.length, order: [] };
}


// ---------- 5. Bellman-Ford ----------
// Goes through every flight in the network again and again until nothing gets better.
// O(V * E) in the worst case. It can handle negative costs, which I do not have.
// It cannot stop early at the destination, it always finds the cost to every airport.
function bellmanFord(net, src, dst, cost, closed) {
  closed = closed || [];
  if (closed[src] || closed[dst]) return emptyAnswer({ passes: 0 });

  var best = [], prev = [];
  for (var i = 0; i < net.n; i++) { best.push(Infinity); prev.push(-1); }
  best[src] = 0;
  var passes = 0, checked = 0;

  for (var round = 1; round < net.n; round++) {
    var changed = false;
    passes++;
    for (var u = 0; u < net.n; u++) {
      if (best[u] === Infinity || closed[u]) continue;
      var to = net.to[u], km = net.km[u];
      for (var k = 0; k < to.length; k++) {
        var v = to[k];
        if (closed[v]) continue;
        checked++;
        var c = best[u] + cost.a * km[k] + cost.b;
        if (c < best[v]) { best[v] = c; prev[v] = u; changed = true; }
      }
    }
    if (!changed) break;              // a whole pass with no improvement, so everything is final
  }

  if (best[dst] === Infinity) return emptyAnswer({ passes: passes, checked: checked });
  return { path: buildPath(prev, src, dst), cost: best[dst], settled: net.n, checked: checked, passes: passes, heapMax: 0, order: [] };
}


// ---------- helpers for showing a route ----------

// km of the flight from u to v, or -1 if there is no such flight
function flightKm(net, u, v) {
  var i = net.to[u].indexOf(v);
  return i === -1 ? -1 : net.km[u][i];
}

// total km of a route
function tripKm(net, path) {
  var total = 0;
  for (var i = 1; i < path.length; i++) total += flightKm(net, path[i - 1], path[i]);
  return total;
}

// total hours of a route: time in the air plus the waits between the flights
function tripHours(net, path, wait) {
  var hours = 0;
  for (var i = 1; i < path.length; i++) hours += flightHours(flightKm(net, path[i - 1], path[i]));
  if (path.length > 2) hours += (path.length - 2) * wait;
  return hours;
}

// Other good routes, for people who do not like the best one.
// Take a route, close one of the airports where it changes planes and search again.
// Do that for every changing airport of the best route, and then for the new routes too.
// Gives back up to "howMany" different routes, best first.
function otherRoutes(net, src, dst, cost, closed, bestPath, howMany) {
  var found = [];
  var seen = {};
  seen[bestPath.join("-")] = true;
  var list = [{ path: bestPath, closed: closed || [] }];

  for (var t = 0; t < list.length && t <= howMany; t++) {
    var path = list[t].path;
    for (var i = 1; i < path.length - 1; i++) {
      var blocked = list[t].closed.slice();
      blocked[path[i]] = true;
      var r = aStar(net, src, dst, cost, blocked);
      if (r.path && !seen[r.path.join("-")]) {
        seen[r.path.join("-")] = true;
        found.push(r);
        list.push({ path: r.path, closed: blocked });
      }
    }
  }
  found.sort(function (x, y) { return x.cost - y.cost; });
  return found.slice(0, howMany);
}

// so the same file works in node (I run the tests from the terminal too)
if (typeof module !== "undefined") {
  module.exports = {
    SPEED: SPEED, GROUND: GROUND, costFor: costFor, greatCircleKm: greatCircleKm, flightHours: flightHours,
    buildNetwork: buildNetwork, makeNetwork: makeNetwork, MinHeap: MinHeap,
    dijkstra: dijkstra, dijkstraSimple: dijkstraSimple, aStar: aStar, bfs: bfs, bellmanFord: bellmanFord,
    flightKm: flightKm, tripKm: tripKm, tripHours: tripHours, otherRoutes: otherRoutes
  };
}

// benchmark.js - the experiments for the performance analysis
// Open benchmark.html and press the button, or run   node js/benchmark.js

if (typeof module !== "undefined") {
  var routing = require("./routing.js");
  for (var key in routing) global[key] = routing[key];
  var data = require("../data/network.js");
  global.AIRPORTS = data.AIRPORTS;
  global.ROUTES = data.ROUTES;
}

var WAIT = 2;
var KINDS = ["km", "time", "flights"];
var KIND_NAME = { km: "Shortest distance", time: "Quickest", flights: "Fewest flights" };

var METHODS = [
  { key: "bfs", name: "Breadth first search", run: function (n, a, b) { return bfs(n, a, b); } },
  { key: "simple", name: "Dijkstra without a heap", run: dijkstraSimple },
  { key: "bellman", name: "Bellman-Ford", run: bellmanFord },
  { key: "dijkstra", name: "Dijkstra with a min-heap", run: dijkstra },
  { key: "astar", name: "A* (the page uses this)", run: aStar }
];

function makeRandom(seed) {
  var s = seed;
  return function () {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

// "count" random pairs of airports that do have a route between them
function randomTrips(network, count, seed) {
  var random = makeRandom(seed);
  var pairs = [];
  while (pairs.length < count) {
    var a = Math.floor(random() * network.n), b = Math.floor(random() * network.n);
    if (a !== b && bfs(network, a, b).path) pairs.push([a, b]);
  }
  return pairs;
}

// A smaller network: only the "count" airports with the most routes and the flights between them.
function smallerNetwork(count) {
  var order = [];
  for (var i = 0; i < AIRPORTS.length; i++) order.push(i);
  order.sort(function (x, y) { return ROUTES[y].length - ROUTES[x].length; });
  var keep = order.slice(0, count);
  var newNumber = {};
  keep.forEach(function (old, i) { newNumber[old] = i; });

  var airports = keep.map(function (old) { return AIRPORTS[old]; });
  var routes = keep.map(function (old) {
    var list = [];
    ROUTES[old].forEach(function (v) { if (newNumber[v] !== undefined) list.push(newNumber[v]); });
    return list;
  });
  return buildNetwork(airports, routes);
}

function countRoutes(network) {
  var total = 0;
  for (var u = 0; u < network.n; u++) total += network.to[u].length;
  return total;
}

// Average time of one search in ms. All the trips are searched again and again for
// at least 30 ms, because one search is too short for the clock to measure.
function averageTime(method, network, trips, cost) {
  for (var w = 0; w < Math.min(5, trips.length); w++) method.run(network, trips[w][0], trips[w][1], cost);   // warm up
  var rounds = 0;
  var t0 = performance.now();
  var t1 = t0;
  while (t1 - t0 < 30) {
    for (var i = 0; i < trips.length; i++) method.run(network, trips[i][0], trips[i][1], cost);
    rounds++;
    t1 = performance.now();
  }
  return (t1 - t0) / (rounds * trips.length);
}


// Experiment 1: every method on the full network, 100 random trips, all three kinds of cost.
function experimentMethods() {
  var net = buildNetwork(AIRPORTS, ROUTES);
  var trips = randomTrips(net, 100, 2026);
  var rows = [];

  METHODS.forEach(function (m) {
    var row = { name: m.name, key: m.key, ms: {}, finished: 0, looked: 0, heap: 0, notBest: 0, extra: 0 };
    KINDS.forEach(function (kind) {
      var cost = costFor(kind, WAIT);
      row.ms[kind] = averageTime(m, net, trips, cost);
    });

    // how much work, counted on the "quickest" searches
    var cost = costFor("time", WAIT);
    trips.forEach(function (t) {
      var r = m.run(net, t[0], t[1], cost);
      var best = dijkstra(net, t[0], t[1], cost);
      row.finished += r.settled / trips.length;
      row.looked += r.checked / trips.length;
      row.heap += r.heapMax / trips.length;
      // is this method's route as quick as the best one?
      var hours = tripHours(net, r.path, WAIT), bestHours = tripHours(net, best.path, WAIT);
      if (hours > bestHours + 1e-6) {
        row.notBest++;
        row.extra += (hours / bestHours - 1) * 100;
      }
    });
    if (row.notBest > 0) row.extra /= row.notBest;
    rows.push(row);
  });
  return { rows: rows, airports: net.n, routes: countRoutes(net), trips: trips.length };
}


// Experiment 2: the same methods on bigger and bigger networks ("quickest" cost).
function experimentSizes() {
  var sizes = [200, 400, 800, 1600, 3257];
  var cost = costFor("time", WAIT);
  var rows = [];
  sizes.forEach(function (size) {
    var net = smallerNetwork(size);
    var trips = randomTrips(net, 60, 500 + size);
    var row = { airports: net.n, routes: countRoutes(net), ms: {} };
    METHODS.forEach(function (m) { row.ms[m.key] = averageTime(m, net, trips, cost); });
    rows.push(row);
  });
  return rows;
}


// Experiment 3: Dijkstra against A*, 1000 random trips on the full network.
// Counts how many airports each one finishes, grouped by how many flights the trip needs.
function experimentWork() {
  var net = buildNetwork(AIRPORTS, ROUTES);
  var trips = randomTrips(net, 1000, 77);
  var groups = [];                       // groups[f] is for trips that need f flights (6 means 6 or more)
  for (var f = 0; f <= 6; f++) groups.push({ trips: 0, dijkstra: 0, astar: 0 });
  var byKind = [];

  KINDS.forEach(function (kind) {
    var cost = costFor(kind, WAIT);
    var total = { kind: kind, dijkstra: 0, astar: 0, heapD: 0, heapA: 0, lookD: 0, lookA: 0 };
    trips.forEach(function (t) {
      var d = dijkstra(net, t[0], t[1], cost), a = aStar(net, t[0], t[1], cost);
      total.dijkstra += d.settled / trips.length;
      total.astar += a.settled / trips.length;
      total.heapD += d.heapMax / trips.length;
      total.heapA += a.heapMax / trips.length;
      total.lookD += d.checked / trips.length;
      total.lookA += a.checked / trips.length;
      if (kind === "time") {
        var g = groups[Math.min(6, bfs(net, t[0], t[1]).flights)];
        g.trips++;
        g.dijkstra += d.settled;
        g.astar += a.settled;
      }
    });
    byKind.push(total);
  });

  groups.forEach(function (g) {
    if (g.trips > 0) { g.dijkstra /= g.trips; g.astar /= g.trips; }
  });
  return { groups: groups, byKind: byKind, trips: trips.length };
}


// ---------- showing the results ----------

function ms(x) {
  if (x < 0.01) return x.toFixed(4);
  if (x < 1) return x.toFixed(3);
  if (x < 100) return x.toFixed(2);
  return x.toFixed(0);
}

var COLOUR = { bfs: "#6c757d", simple: "#eb6834", bellman: "#eda100", dijkstra: "#2a78d6", astar: "#1baf7a" };
var SHAPE = { bfs: "crossRot", simple: "rect", bellman: "rectRot", dijkstra: "triangle", astar: "circle" };

function showExperiments() {
  var one = experimentMethods();
  var two = experimentSizes();
  var three = experimentWork();

  var html = "";
  one.rows.forEach(function (r) {
    var onlyFlights = r.key === "bfs";
    html += "<tr><td>" + r.name + "</td>" +
      '<td class="num">' + ms(r.ms.km) + '</td><td class="num">' + ms(r.ms.time) + '</td><td class="num">' + ms(r.ms.flights) + "</td>" +
      '<td class="num">' + Math.round(r.finished).toLocaleString() + '</td><td class="num">' + Math.round(r.looked).toLocaleString() + "</td>" +
      "<td>" + (r.notBest === 0 ? "always the quickest" : "not the quickest in " + r.notBest + " of " + one.trips + " trips (" + r.extra.toFixed(0) + "% longer)") +
      (onlyFlights ? ". It only counts flights" : "") + "</td></tr>";
  });
  document.getElementById("methodRows").innerHTML = html;

  html = "";
  two.forEach(function (r) {
    html += "<tr><td>" + r.airports.toLocaleString() + '</td><td class="num">' + r.routes.toLocaleString() + "</td>";
    METHODS.forEach(function (m) { html += '<td class="num">' + ms(r.ms[m.key]) + "</td>"; });
    html += "</tr>";
  });
  document.getElementById("sizeRows").innerHTML = html;

  html = "";
  three.byKind.forEach(function (k) {
    html += "<tr><td>" + KIND_NAME[k.kind] + '</td><td class="num">' + Math.round(k.dijkstra).toLocaleString() + '</td><td class="num">' +
      Math.round(k.astar).toLocaleString() + '</td><td class="num">' + (k.astar / k.dijkstra * 100).toFixed(0) + '%</td><td class="num">' +
      Math.round(k.lookD).toLocaleString() + '</td><td class="num">' + Math.round(k.lookA).toLocaleString() + '</td><td class="num">' +
      Math.round(k.heapD).toLocaleString() + '</td><td class="num">' + Math.round(k.heapA).toLocaleString() + "</td></tr>";
  });
  document.getElementById("workRows").innerHTML = html;

  html = "";
  three.groups.forEach(function (g, f) {
    if (g.trips === 0) return;
    html += "<tr><td>" + f + (f === 6 ? " or more" : "") + '</td><td class="num">' + g.trips + '</td><td class="num">' +
      Math.round(g.dijkstra).toLocaleString() + '</td><td class="num">' + Math.round(g.astar).toLocaleString() + "</td></tr>";
  });
  document.getElementById("groupRows").innerHTML = html;

  new Chart(document.getElementById("sizeChart"), {
    type: "line",
    data: {
      labels: two.map(function (r) { return r.airports; }),
      datasets: METHODS.map(function (m) {
        return { label: m.name, data: two.map(function (r) { return r.ms[m.key]; }), borderColor: COLOUR[m.key],
                 backgroundColor: COLOUR[m.key], borderWidth: 2, pointRadius: 4, pointStyle: SHAPE[m.key] };
      })
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { labels: { usePointStyle: true } } },
      scales: {
        y: { type: "logarithmic", title: { display: true, text: "time for one search in ms (log scale)" } },
        x: { title: { display: true, text: "airports in the network" } }
      }
    }
  });

  var shownGroups = three.groups.map(function (g, f) { return { g: g, f: f }; }).filter(function (x) { return x.g.trips > 0; });
  new Chart(document.getElementById("workChart"), {
    type: "bar",
    data: {
      labels: shownGroups.map(function (x) { return x.f + (x.f === 6 ? "+" : ""); }),
      datasets: [
        { label: "Dijkstra", data: shownGroups.map(function (x) { return x.g.dijkstra; }), backgroundColor: COLOUR.dijkstra },
        { label: "A*", data: shownGroups.map(function (x) { return x.g.astar; }), backgroundColor: COLOUR.astar }
      ]
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        y: { title: { display: true, text: "airports finished before the answer" } },
        x: { title: { display: true, text: "flights the trip needs" } }
      }
    }
  });

  document.getElementById("status").textContent = "Done. Times depend on the computer, run it again and they change a little.";
}

if (typeof document !== "undefined") {
  document.getElementById("runBtn").onclick = function () {
    document.getElementById("status").textContent = "Running, this takes about 15 seconds...";
    this.disabled = true;
    setTimeout(showExperiments, 50);     // small wait so the "Running" text shows first
  };
  // benchmark.html?run starts by itself
  if (location.search.indexOf("run") !== -1) setTimeout(showExperiments, 50);
}

if (typeof document === "undefined") {
  // terminal
  var one = experimentMethods();
  console.log("Experiment 1: " + one.trips + " random trips, " + one.airports + " airports, " + one.routes + " routes");
  console.log("method | ms shortest distance | ms quickest | ms fewest flights | airports finished | flights looked at | biggest heap | not the quickest");
  one.rows.forEach(function (r) {
    console.log([r.name, ms(r.ms.km), ms(r.ms.time), ms(r.ms.flights), Math.round(r.finished), Math.round(r.looked), Math.round(r.heap),
                 r.notBest + " trips (" + r.extra.toFixed(0) + "% longer)"].join(" | "));
  });

  var two = experimentSizes();
  console.log("\nExperiment 2: time for one search in ms (quickest), growing network");
  console.log("airports | routes | " + METHODS.map(function (m) { return m.name; }).join(" | "));
  two.forEach(function (r) {
    console.log([r.airports, r.routes].concat(METHODS.map(function (m) { return ms(r.ms[m.key]); })).join(" | "));
  });

  var three = experimentWork();
  console.log("\nExperiment 3: Dijkstra against A*, " + three.trips + " random trips");
  console.log("kind | Dijkstra finished | A* finished | A* / Dijkstra | Dijkstra looked at | A* looked at | Dijkstra heap | A* heap");
  three.byKind.forEach(function (k) {
    console.log([KIND_NAME[k.kind], Math.round(k.dijkstra), Math.round(k.astar), (k.astar / k.dijkstra * 100).toFixed(0) + "%",
                 Math.round(k.lookD), Math.round(k.lookA), Math.round(k.heapD), Math.round(k.heapA)].join(" | "));
  });
  console.log("flights needed | trips | Dijkstra finished | A* finished   (quickest)");
  three.groups.forEach(function (g, f) {
    if (g.trips > 0) console.log([f + (f === 6 ? "+" : ""), g.trips, Math.round(g.dijkstra), Math.round(g.astar)].join(" | "));
  });
}

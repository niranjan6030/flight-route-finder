// tests.js - test cases for routing.js
// Open tests.html in a browser, or run   node js/tests.js   in the terminal.

if (typeof module !== "undefined") {
  var routing = require("./routing.js");
  for (var key in routing) global[key] = routing[key];
  var data = require("../data/network.js");
  global.AIRPORTS = data.AIRPORTS;
  global.ROUTES = data.ROUTES;
}

var net = buildNetwork(AIRPORTS, ROUTES);
var CODE = {};
AIRPORTS.forEach(function (a, i) { CODE[a[0]] = i; });

// My own small random number generator so that the "random" airports are the same
// every time the tests run (Math.random cannot be given a seed).
function makeRandom(seed) {
  var s = seed;
  return function () {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

// "count" pairs of different airports picked at random from the real network
function randomPairs(count, seed) {
  var random = makeRandom(seed);
  var pairs = [];
  while (pairs.length < count) {
    var a = Math.floor(random() * net.n), b = Math.floor(random() * net.n);
    if (a !== b) pairs.push([a, b]);
  }
  return pairs;
}

function same(x, y) { return x === y || Math.abs(x - y) < 1e-6; }

function codes(path) {
  if (!path) return "no route";
  return path.map(function (i) { return AIRPORTS[i][0]; }).join("-");
}

// true if the path really is a trip from src to dst: every step is a flight that exists,
// no airport is used twice and no closed airport is used
function isValidTrip(network, path, src, dst, closed) {
  if (path[0] !== src || path[path.length - 1] !== dst) return false;
  var used = {};
  for (var i = 0; i < path.length; i++) {
    if (used[path[i]] || (closed && closed[path[i]])) return false;
    used[path[i]] = true;
    if (i > 0 && flightKm(network, path[i - 1], path[i]) < 0) return false;
  }
  return true;
}

// ---- the worked example from the poster ----
// Six airports and seven routes (flights go both ways). Distances are the real ones in km.
// Mangaluru is where I start and Guwahati is where I want to go.
var EX = ["IXE", "BLR", "BOM", "HYD", "CCU", "GAU"];
var IXE = 0, BLR = 1, BOM = 2, HYD = 3, CCU = 4, GAU = 5;
var EX_ROUTES = [[IXE, BLR, 307], [IXE, BOM, 715], [BLR, HYD, 456], [BOM, HYD, 623],
                 [BOM, CCU, 1666], [HYD, CCU, 1208], [CCU, GAU, 499]];

function exampleNetwork() {
  var both = [];
  EX_ROUTES.forEach(function (r) { both.push([r[0], r[1], r[2]]); both.push([r[1], r[0], r[2]]); });
  var ex = makeNetwork(6, both);
  // real positions of the six airports, so that A* has something to guess with
  ex.lat = EX.map(function (c) { return AIRPORTS[CODE[c]][4]; });
  ex.lon = EX.map(function (c) { return AIRPORTS[CODE[c]][5]; });
  return ex;
}
function exCodes(path) { return path ? path.map(function (i) { return EX[i]; }).join("-") : "no route"; }

var MODES = ["km", "time", "flights"];
var WAIT = 2;


var TESTS = [

  // ---------- small things ----------

  { name: "Distance formula: a quarter of the way round the equator",
    input: "(0, 0) to (0, 90)",
    expected: "2 x pi x 6371 / 4 = 10007.54 km",
    run: function () {
      var d = greatCircleKm(0, 0, 0, 90);
      return { got: d.toFixed(2) + " km", pass: Math.abs(d - 10007.54) < 0.01 };
    } },

  { name: "Distance formula on real airports",
    input: "London Heathrow to New York JFK",
    expected: "about 5,540 km (published great circle distance)",
    run: function () {
      var a = AIRPORTS[CODE.LHR], b = AIRPORTS[CODE.JFK];
      var d = greatCircleKm(a[4], a[5], b[4], b[5]);
      return { got: d.toFixed(1) + " km", pass: Math.abs(d - 5540) < 5540 * 0.005 };
    } },

  { name: "Min-heap gives the smallest first",
    input: "push 5, 3, 8, 1, 9, 2, 7, 1",
    expected: "1, 1, 2, 3, 5, 7, 8, 9",
    run: function () {
      var h = new MinHeap();
      [5, 3, 8, 1, 9, 2, 7, 1].forEach(function (x) { h.push(x, x); });
      var out = [];
      while (h.size() > 0) out.push(h.pop().cost);
      return { got: out.join(", "), pass: out.join(",") === "1,1,2,3,5,7,8,9" };
    } },

  { name: "Min-heap with a lot of numbers",
    input: "5000 random numbers",
    expected: "they come out in sorted order",
    run: function () {
      var random = makeRandom(7), h = new MinHeap(), ok = true, before = -1, n = 0;
      for (var i = 0; i < 5000; i++) h.push(i, random());
      while (h.size() > 0) { var c = h.pop().cost; if (c < before) ok = false; before = c; n++; }
      return { got: n + " taken out, " + (ok ? "sorted" : "NOT sorted"), pass: ok && n === 5000 };
    } },

  // ---------- the worked example (answers worked out by hand) ----------

  { name: "Worked example, shortest distance",
    input: "Mangaluru (IXE) to Guwahati (GAU), 6 airports",
    expected: "IXE-BLR-HYD-CCU-GAU, 307 + 456 + 1208 + 499 = 2470 km",
    run: function () {
      var r = dijkstra(exampleNetwork(), IXE, GAU, costFor("km", WAIT));
      return { got: exCodes(r.path) + ", " + r.cost + " km", pass: exCodes(r.path) === "IXE-BLR-HYD-CCU-GAU" && r.cost === 2470 };
    } },

  { name: "Worked example, order in which Dijkstra finishes the airports",
    input: "same",
    expected: "IXE (0), BLR (307), BOM (715), HYD (763), CCU (1971), GAU (2470)",
    run: function () {
      var r = dijkstra(exampleNetwork(), IXE, GAU, costFor("km", WAIT));
      var got = r.order.map(function (i) { return EX[i]; }).join(", ");
      return { got: got, pass: got === "IXE, BLR, BOM, HYD, CCU, GAU" };
    } },

  { name: "Worked example, fewest flights",
    input: "same",
    expected: "IXE-BOM-CCU-GAU, 3 flights (2880 km, longer but one flight less)",
    run: function () {
      var ex = exampleNetwork();
      var r = dijkstra(ex, IXE, GAU, costFor("flights", WAIT));
      return { got: exCodes(r.path) + ", " + (r.path.length - 1) + " flights, " + tripKm(ex, r.path) + " km",
               pass: exCodes(r.path) === "IXE-BOM-CCU-GAU" && tripKm(ex, r.path) === 2880 };
    } },

  { name: "Worked example, quickest with 2 hours between flights",
    input: "same",
    expected: "IXE-BOM-CCU-GAU: 2880/800 + 3 x 0.5 + 2 x 2 = 9.10 hours (the 2470 km route takes 11.09)",
    run: function () {
      var ex = exampleNetwork();
      var r = dijkstra(ex, IXE, GAU, costFor("time", WAIT));
      var h = tripHours(ex, r.path, WAIT);
      var other = tripHours(ex, [IXE, BLR, HYD, CCU, GAU], WAIT);
      return { got: exCodes(r.path) + ", " + h.toFixed(2) + " hours (other route " + other.toFixed(2) + ")",
               pass: exCodes(r.path) === "IXE-BOM-CCU-GAU" && same(h, 9.1) && Math.abs(other - 11.0875) < 1e-6 };
    } },

  { name: "From and To are the same airport",
    input: "IXE to IXE",
    expected: "0 km, no flight",
    run: function () {
      var r = dijkstra(exampleNetwork(), IXE, IXE, costFor("km", WAIT));
      return { got: r.cost + " km, " + (r.path.length - 1) + " flights", pass: r.cost === 0 && r.path.length === 1 };
    } },

  { name: "A direct flight exists",
    input: "IXE to BLR",
    expected: "IXE-BLR, 307 km",
    run: function () {
      var r = dijkstra(exampleNetwork(), IXE, BLR, costFor("km", WAIT));
      return { got: exCodes(r.path) + ", " + r.cost + " km", pass: exCodes(r.path) === "IXE-BLR" && r.cost === 307 };
    } },

  { name: "An airport on the best route is closed",
    input: "IXE to GAU, Hyderabad closed",
    expected: "goes round it: IXE-BOM-CCU-GAU, 2880 km",
    run: function () {
      var closed = []; closed[HYD] = true;
      var r = dijkstra(exampleNetwork(), IXE, GAU, costFor("km", WAIT), closed);
      return { got: exCodes(r.path) + ", " + r.cost + " km", pass: exCodes(r.path) === "IXE-BOM-CCU-GAU" && r.cost === 2880 };
    } },

  { name: "The only airport that connects to the destination is closed",
    input: "IXE to GAU, Kolkata closed",
    expected: "no route",
    run: function () {
      var closed = []; closed[CCU] = true;
      var ex = exampleNetwork();
      var all = [dijkstra(ex, IXE, GAU, costFor("km", WAIT), closed), aStar(ex, IXE, GAU, costFor("km", WAIT), closed),
                 bellmanFord(ex, IXE, GAU, costFor("km", WAIT), closed), bfs(ex, IXE, GAU, closed)];
      var none = all.every(function (r) { return r.path === null; });
      return { got: none ? "no route (all four methods)" : "a route was found", pass: none };
    } },

  { name: "Flights are one way",
    input: "3 airports, flights 0 to 1 and 1 to 2 only",
    expected: "0 to 2 works (2 flights), 2 to 0 has no route",
    run: function () {
      var one = makeNetwork(3, [[0, 1, 100], [1, 2, 100]]);
      var go = dijkstra(one, 0, 2, costFor("km", WAIT)), back = dijkstra(one, 2, 0, costFor("km", WAIT));
      return { got: "0 to 2: " + (go.path ? go.path.length - 1 + " flights" : "no route") + ", 2 to 0: " + (back.path ? "found" : "no route"),
               pass: go.cost === 200 && back.path === null };
    } },

  { name: "Worked example with the other methods",
    input: "IXE to GAU, shortest distance",
    expected: "Dijkstra without heap 2470, Bellman-Ford 2470, A* 2470, BFS 3 flights",
    run: function () {
      var ex = exampleNetwork(), c = costFor("km", WAIT);
      var s = dijkstraSimple(ex, IXE, GAU, c), b = bellmanFord(ex, IXE, GAU, c), a = aStar(ex, IXE, GAU, c), q = bfs(ex, IXE, GAU);
      return { got: "no heap " + s.cost + ", Bellman-Ford " + b.cost + ", A* " + a.cost + ", BFS " + q.flights + " flights",
               pass: s.cost === 2470 && b.cost === 2470 && a.cost === 2470 && q.flights === 3 };
    } },

  { name: "Worked example, A* does less work",
    input: "IXE to GAU, shortest distance",
    expected: "A* finishes 5 airports and never Mumbai, Dijkstra finishes all 6",
    run: function () {
      var ex = exampleNetwork(), c = costFor("km", WAIT);
      var a = aStar(ex, IXE, GAU, c), d = dijkstra(ex, IXE, GAU, c);
      var got = a.order.map(function (i) { return EX[i]; }).join(", ");
      return { got: "A*: " + got + " (" + a.settled + "), Dijkstra: " + d.settled,
               pass: a.settled === 5 && a.order.indexOf(BOM) === -1 && d.settled === 6 };
    } },

  // ---------- the real network ----------

  { name: "The data file is loaded and makes sense",
    input: "data/network.js",
    expected: "3257 airports, 37042 routes, no flight from an airport to itself",
    run: function () {
      var routes = 0, bad = 0;
      for (var u = 0; u < net.n; u++) {
        routes += net.to[u].length;
        for (var k = 0; k < net.to[u].length; k++) {
          var v = net.to[u][k];
          if (v === u || v < 0 || v >= net.n || !(net.km[u][k] > 0)) bad++;
        }
      }
      return { got: net.n + " airports, " + routes + " routes, " + bad + " bad ones", pass: net.n === 3257 && routes === 37042 && bad === 0 };
    } },

  { name: "Real direct flight",
    input: "Bengaluru (BLR) to Delhi (DEL)",
    expected: "1 flight, about 1710 km, 1710/800 + 0.5 = 2 h 38 min",
    run: function () {
      var r = aStar(net, CODE.BLR, CODE.DEL, costFor("time", WAIT));
      var km = tripKm(net, r.path), h = tripHours(net, r.path, WAIT);
      return { got: codes(r.path) + ", " + km.toFixed(0) + " km, " + Math.floor(h) + " h " + Math.round((h % 1) * 60) + " min",
               pass: r.path.length === 2 && Math.abs(km - 1710) < 5 && Math.abs(h - 2.6375) < 0.01 };
    } },

  { name: "Real trip with no direct flight",
    input: "Mysuru (MYQ) to Shillong (SHL), quickest",
    expected: "MYQ-BLR-CCU-SHL (Mysuru only flies to Bengaluru, Shillong only to Kolkata)",
    run: function () {
      var r = aStar(net, CODE.MYQ, CODE.SHL, costFor("time", WAIT));
      return { got: codes(r.path) + ", " + tripKm(net, r.path).toFixed(0) + " km", pass: codes(r.path) === "MYQ-BLR-CCU-SHL" };
    } },

  { name: "A* gives the same answer as Dijkstra on the real network",
    input: "300 random pairs of airports x 3 kinds of cost",
    expected: "same cost 900 times",
    run: function () {
      var pairs = randomPairs(300, 11), agree = 0, noRoute = 0;
      MODES.forEach(function (mode) {
        var c = costFor(mode, WAIT);
        pairs.forEach(function (p) {
          var d = dijkstra(net, p[0], p[1], c), a = aStar(net, p[0], p[1], c);
          if (same(d.cost, a.cost)) agree++;
          if (d.path === null) noRoute++;
        });
      });
      return { got: agree + " of 900 the same (" + noRoute + " of them have no route at all)", pass: agree === 900 };
    } },

  // fewer pairs here because these two methods are slow
  { name: "The two slow methods agree as well",
    input: "40 random pairs x 3 kinds of cost",
    expected: "Dijkstra without heap and Bellman-Ford give the same cost as Dijkstra 120 times",
    run: function () {
      var pairs = randomPairs(40, 12), agree = 0;
      MODES.forEach(function (mode) {
        var c = costFor(mode, WAIT);
        pairs.forEach(function (p) {
          var d = dijkstra(net, p[0], p[1], c), s = dijkstraSimple(net, p[0], p[1], c), b = bellmanFord(net, p[0], p[1], c);
          if (same(d.cost, s.cost) && same(d.cost, b.cost)) agree++;
        });
      });
      return { got: agree + " of 120 the same", pass: agree === 120 };
    } },

  { name: "Fewest flights is really the fewest",
    input: "300 random pairs",
    expected: "same number of flights as breadth first search every time",
    run: function () {
      var pairs = randomPairs(300, 22), ok = 0, most = 0;
      var c = costFor("flights", WAIT);
      pairs.forEach(function (p) {
        var a = aStar(net, p[0], p[1], c), q = bfs(net, p[0], p[1]);
        var flights = a.path ? a.path.length - 1 : -1;
        if (flights === q.flights) ok++;
        if (flights > most) most = flights;
      });
      return { got: ok + " of 300 the same (the longest trip needs " + most + " flights)", pass: ok === 300 };
    } },

  { name: "Every route that comes out can really be flown",
    input: "300 random pairs x 3 kinds of cost",
    expected: "starts and ends right, every step is a flight in the data, no airport twice",
    run: function () {
      var pairs = randomPairs(300, 33), valid = 0, total = 0;
      MODES.forEach(function (mode) {
        pairs.forEach(function (p) {
          var a = aStar(net, p[0], p[1], costFor(mode, WAIT));
          if (!a.path) return;
          total++;
          if (isValidTrip(net, a.path, p[0], p[1])) valid++;
        });
      });
      return { got: valid + " of " + total + " routes are valid", pass: valid === total && total > 800 };
    } },

  { name: "Places that cannot be reached",
    input: "Delhi to Akutan (AKB, a small group of airports in Alaska with no flight to the rest), and from Angoon (AGN, no departures in the data) to Delhi",
    expected: "no route, from every method",
    run: function () {
      var c = costFor("time", WAIT), none = 0;
      [[CODE.DEL, CODE.AKB], [CODE.AGN, CODE.DEL]].forEach(function (p) {
        if (dijkstra(net, p[0], p[1], c).path === null) none++;
        if (aStar(net, p[0], p[1], c).path === null) none++;
        if (bellmanFord(net, p[0], p[1], c).path === null) none++;
        if (dijkstraSimple(net, p[0], p[1], c).path === null) none++;
        if (bfs(net, p[0], p[1]).path === null) none++;
      });
      return { got: none + " of 10 answers are \"no route\"", pass: none === 10 };
    } },

  { name: "Closing an airport never gives a better trip",
    input: "200 random pairs, the first airport where the trip changes planes is closed",
    expected: "new route does not use it and is not quicker than before",
    run: function () {
      var pairs = randomPairs(200, 44), c = costFor("time", WAIT), tried = 0, ok = 0, cut = 0;
      pairs.forEach(function (p) {
        var first = aStar(net, p[0], p[1], c);
        if (!first.path || first.path.length < 3) return;
        tried++;
        var closed = []; closed[first.path[1]] = true;
        var second = aStar(net, p[0], p[1], c, closed);
        if (!second.path) { cut++; ok++; return; }
        if (second.cost >= first.cost - 1e-9 && isValidTrip(net, second.path, p[0], p[1], closed)) ok++;
      });
      return { got: ok + " of " + tried + " correct (" + cut + " of them had no other way)", pass: ok === tried && tried > 100 };
    } },

  { name: "Other routes for the user to choose",
    input: "Kochi (COK) to Toronto (YYZ), quickest, 3 other routes asked",
    expected: "3 different routes, none quicker than the best one",
    run: function () {
      var c = costFor("time", WAIT);
      var best = aStar(net, CODE.COK, CODE.YYZ, c);
      var others = otherRoutes(net, CODE.COK, CODE.YYZ, c, [], best.path, 3);
      var names = {}, ok = others.length === 3;
      names[codes(best.path)] = true;
      others.forEach(function (r) {
        if (names[codes(r.path)] || r.cost < best.cost || !isValidTrip(net, r.path, CODE.COK, CODE.YYZ)) ok = false;
        names[codes(r.path)] = true;
      });
      return { got: codes(best.path) + " then " + others.map(function (r) { return codes(r.path); }).join(", "), pass: ok };
    } },

  { name: "A* never looks at more airports than Dijkstra",
    input: "300 random pairs x 3 kinds of cost",
    expected: "airports finished by A* is less or equal 900 times",
    run: function () {
      var pairs = randomPairs(300, 55), ok = 0, sumA = 0, sumD = 0;
      MODES.forEach(function (mode) {
        var c = costFor(mode, WAIT);
        pairs.forEach(function (p) {
          var a = aStar(net, p[0], p[1], c), d = dijkstra(net, p[0], p[1], c);
          if (a.settled <= d.settled) ok++;
          sumA += a.settled; sumD += d.settled;
        });
      });
      return { got: ok + " of 900 (on average A* " + Math.round(sumA / 900) + " airports, Dijkstra " + Math.round(sumD / 900) + ")", pass: ok === 900 };
    } },

  { name: "Answers come quickly",
    input: "the same 900 searches, A* and Dijkstra",
    expected: "the slowest single search is under 50 ms",
    run: function () {
      var pairs = randomPairs(300, 55), worst = 0;
      MODES.forEach(function (mode) {
        var c = costFor(mode, WAIT);
        pairs.forEach(function (p) {
          var t0 = performance.now();
          aStar(net, p[0], p[1], c);
          var t1 = performance.now();
          dijkstra(net, p[0], p[1], c);
          var t2 = performance.now();
          worst = Math.max(worst, t1 - t0, t2 - t1);
        });
      });
      return { got: "slowest search took " + worst.toFixed(1) + " ms", pass: worst < 50 };
    } }
];


function runAllTests() {
  var results = [];
  for (var i = 0; i < TESTS.length; i++) {
    var t = TESTS[i];
    var out;
    try {
      out = t.run();
    } catch (err) {
      out = { got: "ERROR: " + err.message, pass: false };
    }
    results.push({ no: i + 1, name: t.name, input: t.input, expected: t.expected, got: out.got, pass: out.pass });
  }
  return results;
}

if (typeof document !== "undefined") {
  // browser: fill the table in tests.html (after a short wait so that "Running..." shows first)
  setTimeout(function () {
    var results = runAllTests();
    var passed = 0;
    var rows = "";
    results.forEach(function (r) {
      if (r.pass) passed++;
      rows += "<tr><td>" + r.no + "</td><td>" + r.name + "</td><td>" + r.input + "</td><td>" + r.expected +
        "</td><td>" + r.got + '</td><td class="' + (r.pass ? "pass" : "fail") + '">' + (r.pass ? "PASS" : "FAIL") + "</td></tr>";
    });
    document.getElementById("rows").innerHTML = rows;
    var box = document.getElementById("summary");
    box.textContent = passed + " of " + results.length + " test cases passed";
    box.className = "alert " + (passed === results.length ? "alert-success" : "alert-danger");
  }, 50);
} else {
  // terminal
  var all = runAllTests();
  var count = 0;
  all.forEach(function (r) {
    if (r.pass) count++;
    console.log((r.pass ? "PASS  " : "FAIL  ") + r.no + ". " + r.name + "\n        expected: " + r.expected + "\n        got:      " + r.got);
  });
  console.log("\n" + count + " of " + all.length + " test cases passed");
}

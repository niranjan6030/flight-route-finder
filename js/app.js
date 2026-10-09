// app.js - the search page (form and result on the left, map on the right)

var net = buildNetwork(AIRPORTS, ROUTES);

var fromAirport = -1;     // position in AIRPORTS, -1 means nothing is picked yet
var toAirport = -1;
var avoid = [];           // airports the user does not want to pass through
var routes = [];          // routes found by the last search, routes[0] is the best one
var picked = 0;           // which of them is shown in the table and on the map
var last = null;          // numbers from the last search, for the "How was this found?" box
var looking = "";         // which search is drawn on the map: "", "astar" or "dijkstra"
var howOpen = false;

// code -> position, so that "BLR" can be turned into a number quickly
var CODE = {};
AIRPORTS.forEach(function (a, i) { CODE[a[0]] = i; });

var totalRoutes = 0;
ROUTES.forEach(function (r) { totalRoutes += r.length; });
document.getElementById("countAirports").textContent = AIRPORTS.length.toLocaleString();
document.getElementById("countRoutes").textContent = totalRoutes.toLocaleString();


// ---------- small helpers ----------

// "Sao Paulo" must also be found when the file has it with accents
function plain(text) {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// airport names can have ' and & in them
function esc(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function label(i) { return AIRPORTS[i][2] + " (" + AIRPORTS[i][0] + ")"; }

function hoursText(h) {
  var m = Math.round(h * 60);
  if (m < 60) return m + " min";
  return Math.floor(m / 60) + " h " + (m % 60 < 10 ? "0" : "") + (m % 60) + " min";
}

function kmText(km) { return Math.round(km).toLocaleString(); }

function showMessage(text, kind) {
  document.getElementById("message").innerHTML =
    text ? '<div class="alert alert-' + (kind || "info") + ' py-2">' + text + "</div>" : "";
}


// ---------- map ----------

var map = L.map("map", { minZoom: 2, maxZoom: 12, renderer: L.canvas({ tolerance: 6 }) }).setView([21, 80], 4);
map.attributionControl.addAttribution('land: <a href="https://www.naturalearthdata.com">Natural Earth</a> | airports and routes: <a href="https://openflights.org/data">OpenFlights</a>');

// The page draws the land itself from data/world.js, so there is a map even without internet.
// It is drawn three times (one world to the left and one to the right) because a route over
// the Pacific runs off the edge of the middle one.
map.createPane("land");
map.getPane("land").style.zIndex = 150;       // below the OpenStreetMap pictures
var landCanvas = L.canvas({ pane: "land" });
[-360, 0, 360].forEach(function (shift) {
  L.geoJSON(LAND, {
    pane: "land",
    renderer: landCanvas,
    interactive: false,
    coordsToLatLng: function (c) { return L.latLng(c[1], c[0] + shift); },
    style: { color: "#a9b4bf", weight: 1, fillColor: "#f4f1e8", fillOpacity: 1 }
  }).addTo(map);
});

// The OpenStreetMap server only gives its map pictures to a page that is opened from a web address
// (http or https). When this page is opened as a file from the computer the server sends
// "Access blocked" pictures instead, so in that case I do not ask for them and only my own map shows.
var detailedMap = location.protocol === "http:" || location.protocol === "https:";
if (detailedMap) {
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 12,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
}

var dotLayer = L.layerGroup().addTo(map);      // one small dot for every airport
var lookLayer = L.layerGroup().addTo(map);     // airports a search looked at
var routeLayer = L.layerGroup().addTo(map);    // the route that was found

// (the dots are also put on the extra world to the left and to the right, like the land)
AIRPORTS.forEach(function (a, i) {
  [-360, 0, 360].forEach(function (shift) {
    L.circleMarker([a[4], a[5] + shift], { radius: 2.5, stroke: false, fillColor: "#33557a", fillOpacity: 0.6 })
      .on("click", function (e) { airportPopup(i, e.target.getLatLng()); })
      .addTo(dotLayer);
  });
});

// My own map has no place names, so I write the city names of the busiest airports on it.
// The busiest ones in view come first, and a name is skipped if it would sit on top of another one.
var nameLayer = L.layerGroup().addTo(map);
var drawnPath = [];       // airports of the route on the map (they have their own labels)
var BUSIEST = AIRPORTS.map(function (a, i) { return i; });
BUSIEST.sort(function (x, y) { return ROUTES[y].length - ROUTES[x].length; });

function drawNames() {
  nameLayer.clearLayers();
  if (detailedMap) return;
  var view = map.getBounds();
  var placed = [];
  for (var k = 0; k < BUSIEST.length && placed.length < 45; k++) {
    var i = BUSIEST[k];
    var at = [AIRPORTS[i][4], AIRPORTS[i][5]];
    if (!view.contains(at) || drawnPath.indexOf(i) !== -1) continue;
    var p = map.latLngToContainerPoint(at);
    var onTop = placed.some(function (q) { return Math.abs(q.x - p.x) < 80 && Math.abs(q.y - p.y) < 20; });
    if (onTop) continue;
    placed.push(p);
    L.marker(at, { interactive: false, icon: L.divIcon({ className: "cityname", html: esc(AIRPORTS[i][2]), iconSize: [0, 0] }) })
      .addTo(nameLayer);
  }
}
map.on("moveend", drawNames);

// clicking a dot asks if you want to fly from or to that airport
function airportPopup(i, at) {
  var a = AIRPORTS[i];
  var div = document.createElement("div");
  div.innerHTML = "<b>" + esc(label(i)) + "</b><br>" + esc(a[1]) + ", " + esc(a[3]) +
    "<br>" + ROUTES[i].length + " routes from here<br>";
  var fromBtn = document.createElement("button");
  fromBtn.className = "btn btn-sm btn-outline-success mt-1 me-1";
  fromBtn.textContent = "Fly from here";
  fromBtn.onclick = function () { pickFrom(i); map.closePopup(); };
  var toBtn = document.createElement("button");
  toBtn.className = "btn btn-sm btn-outline-danger mt-1";
  toBtn.textContent = "Fly to here";
  toBtn.onclick = function () { pickTo(i); map.closePopup(); };
  div.appendChild(fromBtn);
  div.appendChild(toBtn);
  L.popup().setLatLng(at || [a[4], a[5]]).setContent(div).openOn(map);
}

// small box in the corner of the map that says what the coloured dots mean
var legend = L.control({ position: "bottomleft" });
legend.onAdd = function () {
  this.box = L.DomUtil.create("div", "legend");
  return this.box;
};
legend.addTo(map);

// Points along the shortest way over the globe from one airport to the other,
// so the line on the map is curved like the real flight path (a point every 2 degrees).
function arcPoints(lat1, lon1, lat2, lon2) {
  var p = Math.PI / 180;
  var angle = greatCircleKm(lat1, lon1, lat2, lon2) / 6371;
  if (angle === 0) return [[lat1, lon1]];
  var steps = Math.max(2, Math.ceil(angle / (2 * p)));
  var pts = [];
  for (var i = 0; i <= steps; i++) {
    var f = i / steps;
    var A = Math.sin((1 - f) * angle) / Math.sin(angle);
    var B = Math.sin(f * angle) / Math.sin(angle);
    var x = A * Math.cos(lat1 * p) * Math.cos(lon1 * p) + B * Math.cos(lat2 * p) * Math.cos(lon2 * p);
    var y = A * Math.cos(lat1 * p) * Math.sin(lon1 * p) + B * Math.cos(lat2 * p) * Math.sin(lon2 * p);
    var z = A * Math.sin(lat1 * p) + B * Math.sin(lat2 * p);
    pts.push([Math.atan2(z, Math.sqrt(x * x + y * y)) / p, Math.atan2(y, x) / p]);
  }
  return pts;
}

function drawRoute(path) {
  routeLayer.clearLayers();
  drawnPath = path;
  var line = [];
  var pinAt = [];
  for (var i = 1; i < path.length; i++) {
    var a = AIRPORTS[path[i - 1]], b = AIRPORTS[path[i]];
    var pts = arcPoints(a[4], a[5], b[4], b[5]);
    for (var k = 0; k < pts.length; k++) {
      // A flight over the Pacific goes from longitude 179 to -179. For the map that is a jump
      // across the whole world, so I keep counting past 180 instead (181, 182, ...).
      if (line.length > 0) {
        var before = line[line.length - 1][1];
        while (pts[k][1] - before > 180) pts[k][1] -= 360;
        while (pts[k][1] - before < -180) pts[k][1] += 360;
      }
      line.push(pts[k]);
      if (i === 1 && k === 0) pinAt.push(pts[k]);
    }
    pinAt.push(line[line.length - 1]);
  }

  var drawn = L.polyline(line, { color: "#0d6efd", weight: 4, opacity: 0.9 }).addTo(routeLayer);
  for (var s = 0; s < path.length; s++) {
    var kind = s === 0 ? " start" : (s === path.length - 1 ? " end" : "");
    var text = s === 0 ? "A" : (s === path.length - 1 ? "B" : String(s));
    // name above one pin and below the next one, so two airports close together do not cover each other
    var above = s % 2 === 1;
    L.marker(pinAt[s], { icon: L.divIcon({ className: "pin" + kind, html: text, iconSize: [26, 26] }) })
      .bindTooltip(label(path[s]), { permanent: true, direction: above ? "top" : "bottom", offset: [0, above ? -12 : 12] })
      .addTo(routeLayer);
  }
  routeBounds = drawn.getBounds();
  map.invalidateSize();
  map.fitBounds(routeBounds, { padding: [60, 60], maxZoom: 7 });
  drawNames();
}

// when the window changes size (or the phone is turned) show the whole route again
var routeBounds = null;
map.on("resize", function () {
  if (routeBounds) map.fitBounds(routeBounds, { padding: [60, 60], maxZoom: 7 });
});

// draws the airports that a search looked at before it had the answer
function drawLooked() {
  lookLayer.clearLayers();
  legend.box.innerHTML = "";
  if (!looking || !last) return;
  var order = looking === "astar" ? last.astar.order : last.dijkstra.order;
  var colour = looking === "astar" ? "#7b2cbf" : "#f77f00";
  order.forEach(function (u) {
    L.circleMarker([AIRPORTS[u][4], AIRPORTS[u][5]], { radius: 4, stroke: false, fillColor: colour, fillOpacity: 0.85, interactive: false })
      .addTo(lookLayer);
  });
  legend.box.innerHTML = '<i style="background:' + colour + '"></i>' + order.length.toLocaleString() + " airports looked at by " +
    (looking === "astar" ? "A*" : "Dijkstra") + ' &nbsp; <i style="background:#33557a"></i>all other airports';
}


// ---------- From, To and Avoid boxes ----------

// text that the search box looks in, made once for every airport
var SEARCH = AIRPORTS.map(function (a) {
  return plain(a[0] + " " + a[2] + " " + a[1] + " " + a[3] + " " + (a[6] || ""));
});

// up to 8 airports that match what was typed
function findAirports(typed) {
  var q = plain(typed.trim());
  if (q.length < 2) return [];
  var hits = [];
  for (var i = 0; i < AIRPORTS.length; i++) {
    var a = AIRPORTS[i];
    var rank = -1;
    // The whole city name comes before the 3 letter code: "goa" is also the code of Genoa
    // and "leh" the code of Le Havre, but somebody who types that wants Goa and Leh.
    if (plain(a[2]) === q || (a[6] && plain(a[6]) === q)) rank = 0;                      // the whole city name
    else if (a[0].toLowerCase() === q) rank = 1;                                         // the 3 letter code
    else if (plain(a[2]).indexOf(q) === 0 || (a[6] && plain(a[6]).indexOf(q) === 0)) rank = 2;   // start of the city name
    else if (SEARCH[i].indexOf(q) !== -1) rank = 3;                                      // anywhere else
    if (rank !== -1) hits.push({ i: i, rank: rank });
  }
  // inside each group the airports with more routes come first
  hits.sort(function (x, y) { return x.rank - y.rank || ROUTES[y.i].length - ROUTES[x.i].length; });
  return hits.slice(0, 8).map(function (h) { return h.i; });
}

// makes a text box show matching airports under it while the user types
function setupBox(inputId, listId, onPick, onType) {
  var input = document.getElementById(inputId);
  var list = document.getElementById(listId);
  var hits = [];

  function choose(i) {
    list.innerHTML = "";
    onPick(i);
  }

  input.oninput = function () {
    if (onType) onType();
    hits = findAirports(input.value);
    list.innerHTML = "";
    hits.forEach(function (i) {
      var item = document.createElement("a");
      item.className = "list-group-item list-group-item-action";
      item.innerHTML = "<b>" + esc(label(i)) + '</b> <span class="text-muted">' + esc(AIRPORTS[i][1]) + ", " + esc(AIRPORTS[i][3]) + "</span>";
      // mousedown and not click, because the box loses focus before a click arrives
      item.onmousedown = function (e) { e.preventDefault(); choose(i); };
      list.appendChild(item);
    });
    if (hits.length === 0 && input.value.trim().length >= 2) {
      list.innerHTML = '<div class="list-group-item text-muted">No airport found with that name.</div>';
    }
  };
  input.onkeydown = function (e) {
    if (e.key === "Enter" && hits.length > 0 && list.innerHTML !== "") choose(hits[0]);
    else if (e.key === "Enter") findRoute();
  };
  input.onblur = function () { list.innerHTML = ""; };
}

function pickFrom(i) {
  fromAirport = i;
  document.getElementById("fromBox").value = i === -1 ? "" : label(i);
  clearResult();
}

function pickTo(i) {
  toAirport = i;
  document.getElementById("toBox").value = i === -1 ? "" : label(i);
  clearResult();
}

function addAvoid(i) {
  document.getElementById("avoidBox").value = "";
  if (avoid.indexOf(i) === -1) avoid.push(i);
  showAvoid();
}

function showAvoid() {
  var box = document.getElementById("avoidChips");
  box.innerHTML = "";
  avoid.forEach(function (i, pos) {
    var chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = label(i);
    var x = document.createElement("button");
    x.innerHTML = "&times;";
    x.title = "Take out of the list";
    x.onclick = function () {
      avoid.splice(pos, 1);
      showAvoid();
      if (routes.length > 0 || last) findRoute();
    };
    chip.appendChild(x);
    box.appendChild(chip);
  });
}

function clearResult() {
  routes = [];
  last = null;
  drawnPath = [];
  routeBounds = null;
  routeLayer.clearLayers();
  lookLayer.clearLayers();
  legend.box.innerHTML = "";
  document.getElementById("result").innerHTML = "";
  showMessage("");
}

setupBox("fromBox", "fromList", pickFrom, function () { fromAirport = -1; });
setupBox("toBox", "toList", pickTo, function () { toAirport = -1; });
setupBox("avoidBox", "avoidList", function (i) { addAvoid(i); if (last) findRoute(); });


// ---------- the search ----------

function findRoute() {
  if (fromAirport === -1 || toAirport === -1) {
    clearResult();
    showMessage("Type a city or airport in <b>From</b> and in <b>To</b> and pick one from the list that drops down.", "warning");
    return;
  }
  if (fromAirport === toAirport) {
    clearResult();
    showMessage("From and To are the same airport.", "warning");
    return;
  }
  var mode = document.querySelector("input[name=mode]:checked").value;
  var wait = Number(document.getElementById("wait").value);
  var cost = costFor(mode, wait);

  var closed = [];
  avoid.forEach(function (i) { closed[i] = true; });
  if (closed[fromAirport] || closed[toAirport]) {
    clearResult();
    showMessage(esc(label(closed[fromAirport] ? fromAirport : toAirport)) +
      " is in your list of airports to avoid. Take it out of the list first.", "warning");
    return;
  }

  // The page uses A*. Plain Dijkstra is run as well, only to show the difference in the "How" box.
  var t0 = performance.now();
  var astar = aStar(net, fromAirport, toAirport, cost, closed);
  var t1 = performance.now();
  var plainD = dijkstra(net, fromAirport, toAirport, cost, closed);
  var t2 = performance.now();

  last = { mode: mode, wait: wait, astar: astar, dijkstra: plainD, msAstar: t1 - t0, msDijkstra: t2 - t1 };
  picked = 0;

  if (!astar.path) {
    routes = [];
    routeLayer.clearLayers();
    drawLooked();
    document.getElementById("result").innerHTML = "";
    showMessage("No way found from " + esc(label(fromAirport)) + " to " + esc(label(toAirport)) + " with the flights in the data." +
      (avoid.length ? " Try taking an airport out of your avoid list." : ""), "danger");
    return;
  }
  showMessage("");
  routes = [astar.path];
  otherRoutes(net, fromAirport, toAirport, cost, closed, astar.path, 3).forEach(function (r) { routes.push(r.path); });
  showResult();
}

function changedAt(path) {
  var names = [];
  for (var i = 1; i < path.length - 1; i++) names.push(AIRPORTS[path[i]][2]);
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

function showResult() {
  var mode = last.mode, wait = last.wait;
  var best = routes[0];
  var html = "";

  // green box with the answer
  var what = mode === "km" ? "Shortest distance" : (mode === "flights" ? "Fewest flights" : "Quickest way");
  html += '<div class="alert alert-success mt-3 mb-2"><div class="headline"><b>';
  if (best.length === 2) {
    html += "There is a direct flight, about " + hoursText(tripHours(net, best, wait));
  } else {
    html += what + ": " + (best.length - 1) + " flights, about " + hoursText(tripHours(net, best, wait));
  }
  html += "</b></div>" + esc(label(best[0])) + " to " + esc(label(best[best.length - 1])) + ", " + kmText(tripKm(net, best)) + " km in the air.";
  if (best.length > 2) html += " You change planes at " + esc(changedAt(best)) + ".";
  html += "</div>";

  // the best route and the other choices
  if (routes.length > 1) {
    html += '<table class="table table-sm table-bordered table-hover mb-2"><tr><th>Routes found (click to see)</th>' +
      '<th class="num">Flights</th><th class="num">Time</th><th class="num">km</th></tr>';
    routes.forEach(function (path, r) {
      var codes = path.map(function (i) { return AIRPORTS[i][0]; }).join(" - ");
      html += '<tr class="pickable' + (r === picked ? " table-primary" : "") + '" data-r="' + r + '"><td>' + codes +
        (r === 0 ? ' <span class="badge bg-success">best</span>' : "") + '</td><td class="num">' + (path.length - 1) +
        '</td><td class="num">' + hoursText(tripHours(net, path, wait)) + '</td><td class="num">' + kmText(tripKm(net, path)) + "</td></tr>";
    });
    html += "</table>";
  }

  // every flight of the route that is picked
  var path = routes[picked];
  html += '<table class="table table-sm table-bordered mb-2"><tr><th>#</th><th>Flight</th><th class="num">km</th><th class="num">Time</th></tr>';
  for (var i = 1; i < path.length; i++) {
    var a = path[i - 1], b = path[i];
    var km = flightKm(net, a, b);
    var link = "https://www.google.com/travel/flights?q=" + encodeURIComponent("Flights from " + AIRPORTS[a][0] + " to " + AIRPORTS[b][0]);
    html += "<tr><td>" + i + "</td><td>" + esc(label(a)) + " to " + esc(label(b)) +
      '<br><a class="small" target="_blank" rel="noopener" href="' + link + '">check this flight on Google Flights</a></td>' +
      '<td class="num">' + kmText(km) + '</td><td class="num">' + hoursText(flightHours(km)) + "</td></tr>";
    if (i < path.length - 1) {
      html += '<tr><td class="waitrow"></td><td class="waitrow">change planes at ' + esc(AIRPORTS[b][1]) +
        ' &nbsp; <a href="#" class="avoidLink" data-i="' + b + '">avoid this airport</a></td>' +
        '<td class="waitrow"></td><td class="waitrow num">' + hoursText(wait) + "</td></tr>";
    }
  }
  html += '<tr><th></th><th>Total</th><th class="num">' + kmText(tripKm(net, path)) + '</th><th class="num">' +
    hoursText(tripHours(net, path, wait)) + "</th></tr></table>";

  // how the answer was found
  var same = Math.abs(last.astar.cost - last.dijkstra.cost) < 1e-9;
  html += '<details class="how"' + (howOpen ? " open" : "") + "><summary>How was this found?</summary>" +
    '<p class="mb-1 mt-1">The page uses <b>A* search</b>, which is Dijkstra\'s algorithm with a guess added (the guess is one direct flight to the destination). ' +
    "It looked at <b>" + last.astar.settled.toLocaleString() + "</b> of the " + AIRPORTS.length.toLocaleString() + " airports and " +
    last.astar.checked.toLocaleString() + " flights before it was sure (" + last.msAstar.toFixed(2) + " ms).</p>" +
    '<p class="mb-1">Plain <b>Dijkstra</b> looked at <b>' + last.dijkstra.settled.toLocaleString() + "</b> airports and " +
    last.dijkstra.checked.toLocaleString() + " flights (" + last.msDijkstra.toFixed(2) + " ms) and " +
    (same ? "got the same answer." : '<span class="fail">got a different answer, this should not happen.</span>') + "</p>" +
    '<div>Show on the map what was looked at: ' +
    lookRadio("", "nothing") + lookRadio("astar", "A*") + lookRadio("dijkstra", "Dijkstra") + "</div></details>";

  var box = document.getElementById("result");
  box.innerHTML = html;

  box.querySelectorAll("tr.pickable").forEach(function (row) {
    row.onclick = function () { picked = Number(row.getAttribute("data-r")); showResult(); };
  });
  box.querySelectorAll("a.avoidLink").forEach(function (a) {
    a.onclick = function (e) {
      e.preventDefault();
      addAvoid(Number(a.getAttribute("data-i")));
      findRoute();
    };
  });
  box.querySelectorAll("input[name=look]").forEach(function (radio) {
    radio.onchange = function () { looking = radio.value; drawLooked(); };
  });
  box.querySelector("details").ontoggle = function () { howOpen = this.open; };

  drawLooked();
  drawRoute(path);
}

function lookRadio(value, text) {
  return '<label class="me-3"><input type="radio" name="look" value="' + value + '"' + (looking === value ? " checked" : "") + "> " + text + "</label>";
}


// ---------- buttons ----------

document.getElementById("goBtn").onclick = function () {
  findRoute();
  // on a phone the answer is below the form, so bring it into view
  if (window.innerWidth < 768 && routes.length > 0) document.getElementById("result").scrollIntoView();
};

document.getElementById("swapBtn").onclick = function (e) {
  e.preventDefault();
  var f = fromAirport, t = toAirport, had = last !== null;
  pickFrom(t);
  pickTo(f);
  if (had) findRoute();
};

// changing an option searches again if there is already an answer on the page
document.querySelectorAll("input[name=mode]").forEach(function (radio) {
  radio.onchange = function () { if (last) findRoute(); };
});
document.getElementById("wait").onchange = function () { if (last) findRoute(); };

document.querySelectorAll("a.example").forEach(function (a) {
  a.onclick = function (e) {
    e.preventDefault();
    pickFrom(CODE[a.getAttribute("data-from")]);
    pickTo(CODE[a.getAttribute("data-to")]);
    findRoute();
  };
});

drawNames();

// A search can be put in the address, for example
//   index.html?from=MYQ&to=SHL&mode=time&wait=2&avoid=DEL,BOM&look=dijkstra
// (I use this for the screenshots, and it also lets you send a search to somebody)
(function () {
  var q = new URLSearchParams(location.search);
  if (!q.get("from") || !q.get("to")) return;
  var f = CODE[q.get("from").toUpperCase()], t = CODE[q.get("to").toUpperCase()];
  if (f === undefined || t === undefined) return;
  if (q.get("mode")) {
    var radio = document.querySelector('input[name=mode][value="' + q.get("mode") + '"]');
    if (radio) radio.checked = true;
  }
  if (q.get("wait")) document.getElementById("wait").value = q.get("wait");
  (q.get("avoid") || "").split(",").forEach(function (code) {
    if (CODE[code.toUpperCase()] !== undefined) avoid.push(CODE[code.toUpperCase()]);
  });
  showAvoid();
  if (q.get("look") === "astar" || q.get("look") === "dijkstra") { looking = q.get("look"); howOpen = true; }
  pickFrom(f);
  pickTo(t);
  findRoute();
  if (q.get("pick") && routes[Number(q.get("pick"))]) { picked = Number(q.get("pick")); showResult(); }
})();

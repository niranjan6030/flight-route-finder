# Flight Route Finder

There is no direct flight between most pairs of airports. From Mysuru you can only fly to Bengaluru, and to
Shillong you can only fly from Kolkata. So which flights do you take, and where do you change?

This is a small web page that answers that. You pick a starting airport and a destination, say what matters most
(reach quickest, fewest flights or shortest distance), and it shows the flights to take, the other good routes
and the route on a world map. If you do not want to pass through some airport (it is closed, there is fog, you
need a visa there) you click "avoid this airport" and it finds a way round.

It is a shortest path problem on a graph of 3,257 airports and 37,042 routes. I solve it with Dijkstra's
algorithm and its faster version, A* search.

**Try it:** https://niranjan6030.github.io/flight-route-finder/

Blog post that explains everything: https://niranjan6030.github.io/flight-route-finder/blog.html

Poster: [poster/poster.pdf](poster/poster.pdf)

## How to run

Just open `index.html` in a browser (double click it). Nothing to install, and it works without internet.

The page draws the world map itself from a land outline file, so it does not need a map server. If the page is
opened from a web address (a local server or GitHub Pages) it also puts the detailed OpenStreetMap on top. It does
not do that when opened as a file, because the OpenStreetMap server refuses pages that are opened as a file and
sends "Access blocked" pictures.

To rebuild the poster, start a small server in this folder and open http://localhost:8764

```bash
python3 -m http.server 8764
```

Click one of the examples under the button (Mysuru to Shillong, Hubballi to Leh, Kochi to Toronto) to try it.
A search can also be put in the address, like `index.html?from=MYQ&to=SHL`.

## Files

| File | What it is |
|---|---|
| `index.html`, `js/app.js` | the search page (form, result, map) |
| `js/routing.js` | the algorithms. Everything else uses this file |
| `data/network.js` | the airports and routes that the page loads |
| `data/world.js` | the outline of the land, for the map |
| `data/raw/` | the OpenFlights files and the Natural Earth file as I downloaded them |
| `tools/build_data.py` | makes `data/network.js` from the raw files |
| `tools/build_map.py` | makes `data/world.js` from the Natural Earth file |
| `blog.html` | the write-up: problem, algorithm, tests, complexity, experiments |
| `tests.html`, `js/tests.js` | 27 test cases, they run when the page opens |
| `benchmark.html`, `js/benchmark.js` | the timing experiments with charts |
| `poster/` | the poster (HTML source, PDF, PNG) and the screenshots used in it |
| `lib/` | Leaflet, Bootstrap and Chart.js, saved here so the pages do not need a CDN |

## The data

The airports and routes are from the [OpenFlights](https://openflights.org/data) database. `tools/build_data.py`
cleans it:

- airports without a 3-letter code are dropped
- the same route is listed once for every airline, I keep each (from, to) pair once. 67,663 rows become 37,042
- 11 rows are flights with a stop in between, those are dropped
- only airports that have at least one flight are kept (3,257 in 225 countries)
- the names of 20 Indian cities are old or misspelt in the file (Madras, Bangalore, Patina, Tirupeti). I changed them
  to the names used now and kept the old one for the search box

```bash
python3 tools/build_data.py
```

820 routes have no flight back in the data, so the graph is directed.

## The algorithm in short

Airports are nodes. A flight from A to B is an edge. Every flight has a cost `a * km + b`:

| Best means | a | b | Total is in |
|---|---|---|---|
| shortest distance | 1 | 0 | km |
| quickest | 1/800 | 0.5 + wait | hours |
| fewest flights | 0.000001 | 1 | flights |

km is the great circle distance (haversine formula). 800 km/h is the speed of a jet, half an hour is added to
every flight for take-off and landing, and "wait" is the time you want between two flights.

1. **Dijkstra** - the start gets cost 0. Keep taking the airport with the smallest cost out of a min-heap, its
   cost is then final. For every flight out of it, if that gives the next airport a smaller cost, write it down
   and put it in the heap. Stop when the destination comes out.
2. **A\*** - the same, but the heap is ordered by cost so far + a guess of the cost that is left. The guess is the
   cost of one direct flight to the destination. No real route can be cheaper than that, so the answer is still
   the best one, but the search goes towards the destination and not in every direction.

The page uses A*. It also runs plain Dijkstra and shows how many airports each one looked at (open
"How was this found?" under the result).

For comparing I also wrote breadth first search, Dijkstra without a heap and Bellman-Ford. They are in the same file.

## Tests and experiments

```bash
node js/tests.js
node js/benchmark.js
```

or open `tests.html` and `benchmark.html`.

Some numbers from my laptop (Chrome 154, MacBook Air M4), average of 100 random trips on the full network,
"quickest" cost:

| Method | Time for one search | Airports finished | Always the quickest route? |
|---|---|---|---|
| Breadth first search | 0.14 ms | 1,496 | no, wrong in 72 of 100 trips |
| Dijkstra without a heap | 13.15 ms | 1,640 | yes |
| Bellman-Ford | 1.09 ms | all 3,257 | yes |
| Dijkstra with a min-heap | 0.63 ms | 1,640 | yes |
| A* | 0.28 ms | 245 | yes |

## Things it does not do

- The routes are from 2014. Some of those flights do not run now and new ones are missing. Check with the airline.
- No timetable. The wait between two flights is the same number everywhere.
- No ticket prices.
- It does not know that two airports can be in the same city, so it will not tell you to go from one to the other by road.

## Credits

- Airports and routes: OpenFlights (openflights.org/data), made available under the Open Database License
- Land outline: Natural Earth (naturalearthdata.com), public domain
- Detailed map when opened from a web address: OpenStreetMap contributors
- Map library: Leaflet. Styling: Bootstrap. Charts: Chart.js
- E. W. Dijkstra, "A note on two problems in connexion with graphs", Numerische Mathematik, 1959
- P. Hart, N. Nilsson, B. Raphael, "A formal basis for the heuristic determination of minimum cost paths", 1968 (A*)
- Before starting I looked at two student projects on GitHub that also use this data, to see how other people
  did it: RaviPatel1713/Fly-Right- (C++, BFS and Dijkstra) and charafmrah/flight-planning-system (Android)

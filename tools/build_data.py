# build_data.py
# Reads the two OpenFlights files and writes data/network.js, which the web page loads.
# Run it from the project folder:
#
#     python3 tools/build_data.py
#
# airports.dat columns: id, name, city, country, IATA code, ICAO code, latitude, longitude, ...
# routes.dat columns:   airline, airline id, from, from id, to, to id, codeshare, stops, plane
# In both files a missing value is written as \N

import csv
import json
import sys

RAW = sys.argv[1] if len(sys.argv) > 1 else "data/raw"
OUT = sys.argv[2] if len(sys.argv) > 2 else "data/network.js"

# The city names in the file are old or misspelt for many Indian airports.
# People will type the new name, so I change them here. The old one is kept for the search box.
CITY_FIX = {
    "Madras": "Chennai",
    "Bangalore": "Bengaluru",
    "Calicut": "Kozhikode",
    "Trivandrum": "Thiruvananthapuram",
    "Baroda": "Vadodara",
    "Mysore": "Mysuru",
    "Mangalore": "Mangaluru",
    "Hubli": "Hubballi",
    "Belgaum": "Belagavi",
    "Allahabad": "Prayagraj",
    "Patina": "Patna",
    "Tirupeti": "Tirupati",
    "Ludhiaha": "Ludhiana",
    "Bhaunagar": "Bhavnagar",
    "Baghdogra": "Bagdogra",
    "Vishakhapatnam": "Visakhapatnam",
    "Aizwal": "Aizawl",
    "Kulu": "Kullu",
    "Mohanbari": "Dibrugarh",
    "Dehra Dun": "Dehradun",
}

# ---- airports ----
by_id = {}       # OpenFlights id -> airport
by_code = {}     # IATA code -> airport
with open(RAW + "/airports.dat", encoding="utf-8") as f:
    for row in csv.reader(f):
        code = row[4]
        if code == "\\N" or len(code) != 3:
            continue          # no 3-letter code, passengers cannot book these
        city = row[2]
        old = ""
        if row[3] == "India" and city in CITY_FIX:
            old = city
            city = CITY_FIX[city]
        airport = {
            "code": code, "name": row[1], "city": city, "country": row[3],
            "lat": round(float(row[6]), 4), "lon": round(float(row[7]), 4), "old": old,
        }
        by_id[row[0]] = airport
        by_code[code] = airport

# ---- routes ----
# The same route is listed once for every airline that flies it. I only need to know
# that a flight from A to B exists, so I keep each (from, to) pair once.
pairs = set()
rows = 0
dropped = 0
with open(RAW + "/routes.dat", encoding="utf-8") as f:
    for row in csv.reader(f):
        rows += 1
        if row[7] != "0":
            continue          # 11 rows are flights with a stop in between, not direct
        a = by_id.get(row[3]) or by_code.get(row[2])
        b = by_id.get(row[5]) or by_code.get(row[4])
        if a is None or b is None:
            dropped += 1      # airport is not in airports.dat or has no code
            continue
        if a["code"] == b["code"]:
            continue
        pairs.add((a["code"], b["code"]))

# only keep airports that have at least one flight
used = sorted(set(code for pair in pairs for code in pair))
position = {code: i for i, code in enumerate(used)}

routes = [[] for _ in used]
for a, b in pairs:
    routes[position[a]].append(position[b])
for r in routes:
    r.sort()

one_way = sum(1 for (a, b) in pairs if (b, a) not in pairs)

with open(OUT, "w", encoding="utf-8") as f:
    f.write("// Made by tools/build_data.py from the OpenFlights data (openflights.org/data). Do not edit by hand.\n")
    f.write("// AIRPORTS[i] = [code, airport name, city, country, latitude, longitude, old spelling of the city]\n")
    f.write("// ROUTES[i]   = the airports you can fly to from airport i (the numbers are positions in AIRPORTS)\n")
    f.write("var AIRPORTS = [\n")
    for code in used:
        a = by_code[code]
        item = [a["code"], a["name"], a["city"], a["country"], a["lat"], a["lon"]]
        if a["old"]:
            item.append(a["old"])
        f.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + ",\n")
    f.write("];\n")
    f.write("var ROUTES = [\n")
    for r in routes:
        f.write(json.dumps(r, separators=(",", ":")) + ",\n")
    f.write("];\n")
    f.write('if (typeof module !== "undefined") module.exports = { AIRPORTS: AIRPORTS, ROUTES: ROUTES };\n')

print("rows in routes.dat:      ", rows)
print("rows dropped:            ", dropped)
print("airports with a flight:  ", len(used))
print("routes (A to B, one way):", len(pairs))
print("routes with no way back: ", one_way)
print("countries:               ", len(set(by_code[c]["country"] for c in used)))
print("written to", OUT)

# build_map.py
# Makes data/world.js (the outline of the land) from the Natural Earth file, so that the page
# can draw a world map by itself and does not need a map server.
# Run it from the project folder:
#
#     python3 tools/build_map.py
#
# The Natural Earth file has 60,669 points. That is more detail than the page needs,
# so points that are very close to the one before are left out.

import json
import sys

RAW = sys.argv[1] if len(sys.argv) > 1 else "data/raw/natural_earth/ne_50m_land.geojson"
OUT = sys.argv[2] if len(sys.argv) > 2 else "data/world.js"

GAP = 0.08      # degrees (about 8 km). A point closer than this to the last kept point is dropped


def thin(ring):
    kept = [ring[0]]
    for lon, lat in ring[1:-1]:
        if abs(lon - kept[-1][0]) >= GAP or abs(lat - kept[-1][1]) >= GAP:
            kept.append([lon, lat])
    kept.append(ring[-1])
    if len(kept) < 4:
        kept = ring          # a very small island, keep it as it is
    return [[round(lon, 2), round(lat, 2)] for lon, lat in kept]


with open(RAW, encoding="utf-8") as f:
    world = json.load(f)

polygons = []
before = 0
after = 0
for feature in world["features"]:
    shape = feature["geometry"]
    parts = [shape["coordinates"]] if shape["type"] == "Polygon" else shape["coordinates"]
    for polygon in parts:
        rings = []
        for ring in polygon:
            before += len(ring)
            small = thin(ring)
            after += len(small)
            rings.append(small)
        polygons.append(rings)

with open(OUT, "w", encoding="utf-8") as f:
    f.write("// Made by tools/build_map.py from the Natural Earth land outline (naturalearthdata.com). Do not edit by hand.\n")
    f.write("// It is a GeoJSON MultiPolygon: a list of pieces of land, every piece is a list of [longitude, latitude] points.\n")
    f.write('var LAND = {"type":"MultiPolygon","coordinates":[\n')
    f.write(",\n".join(json.dumps(p, separators=(",", ":")) for p in polygons))
    f.write("\n]};\n")

print("pieces of land:", len(polygons))
print("points before: ", before)
print("points after:  ", after)
print("written to", OUT)

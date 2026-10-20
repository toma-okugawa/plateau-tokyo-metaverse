"""PLATEAU CityGML (bldg) -> compact JSON for the Three.js metaverse.

Usage:
  python scripts/convert_citygml.py <bldg.gml> [more.gml ...] -o public/data/<id>.json
      --id marunouchi --name "丸の内・東京駅" --origin 35.6812 139.7671 --radius 1100 [--lod2]
      [--codelists <dir with BuildingRiverFloodingRiskAttribute_description.xml>]

Output per building:
  fp : LOD1 footprint ring [x0, z0, x1, z1, ...] in local meters (x = east, z = south)
  h  : measured height (m), b: ground elevation (m)
  g  : (with --lod2) LOD2 mesh {"p": [x, y, z, ...] in decimeters (y = height above b), "i": [triangle indices]}
  flood / floodRank / floodRiver : river-flood risk attributes (uro:BuildingRiverFloodingRiskAttribute)
"""
import argparse
import json
import math
import os
import xml.etree.ElementTree as ET

GML = '{http://www.opengis.net/gml}'
BLDG = '{http://www.opengis.net/citygml/building/2.0}'
GEN_SURFACES = ('RoofSurface', 'WallSurface', 'OuterCeilingSurface', 'OuterFloorSurface', 'ClosureSurface')


def local(tag):
    return tag.rsplit('}', 1)[-1]


class Projector:
    """Equirectangular projection around the area origin (accurate enough for a few km)."""

    def __init__(self, lat, lon):
        self.lat, self.lon = lat, lon
        self.kx = 111320.0 * math.cos(math.radians(lat))
        self.ky = 110574.0

    def xz(self, lat, lon):
        return (lon - self.lon) * self.kx, -(lat - self.lat) * self.ky


def parse_poslist(text):
    v = [float(t) for t in text.split()]
    return [(v[i], v[i + 1], v[i + 2]) for i in range(0, len(v) - 2, 3)]


# ---------------------------------------------------------------- triangulation
def _area2(poly):
    a = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        a += x1 * y2 - x2 * y1
    return a


def _inside(p, a, b, c):
    def s(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    d1, d2, d3 = s(p, a, b), s(p, b, c), s(p, c, a)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


def ear_clip(poly2d):
    """Triangulate a simple polygon given as 2D points; returns index triples."""
    n = len(poly2d)
    if n < 3:
        return []
    idx = list(range(n))
    if _area2(poly2d) < 0:
        idx.reverse()
    tris = []
    guard = 0
    while len(idx) > 3 and guard < n * n:
        guard += 1
        found = False
        m = len(idx)
        for k in range(m):
            i0, i1, i2 = idx[(k - 1) % m], idx[k], idx[(k + 1) % m]
            a, b, c = poly2d[i0], poly2d[i1], poly2d[i2]
            cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
            if cross <= 1e-12:
                continue
            if any(_inside(poly2d[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            tris.append((i0, i1, i2))
            del idx[k]
            found = True
            break
        if not found:
            break
    if len(idx) == 3:
        tris.append(tuple(idx))
    elif len(idx) > 3:  # degenerate leftovers: fan
        for k in range(1, len(idx) - 1):
            tris.append((idx[0], idx[k], idx[k + 1]))
    return tris


def triangulate3d(pts):
    """pts: list of (x, y, z) local meters, closed ring without the duplicate end point."""
    nx = ny = nz = 0.0
    for i in range(len(pts)):
        x1, y1, z1 = pts[i]
        x2, y2, z2 = pts[(i + 1) % len(pts)]
        nx += (y1 - y2) * (z1 + z2)
        ny += (z1 - z2) * (x1 + x2)
        nz += (x1 - x2) * (y1 + y2)
    ax, ay, az = abs(nx), abs(ny), abs(nz)
    if ax >= ay and ax >= az:
        p2 = [(p[1], p[2]) for p in pts]
        flip = nx < 0
    elif ay >= az:
        p2 = [(p[2], p[0]) for p in pts]
        flip = ny < 0
    else:
        p2 = [(p[0], p[1]) for p in pts]
        flip = nz < 0
    tris = ear_clip(p2)
    # keep the original winding so normals point outward
    out = []
    for a, b, c in tris:
        orient = _area2([p2[a], p2[b], p2[c]]) > 0
        if orient == flip:
            out.append((a, c, b))
        else:
            out.append((a, b, c))
    return out


# ---------------------------------------------------------------- building
def building_record(el, proj, radius, lod2, rivers):
    rec = {'id': el.get(GML + 'id')}
    attrs = {}
    flood = None
    for child in el.iter():
        t = local(child.tag)
        if t == 'BuildingRiverFloodingRiskAttribute':
            d = r = desc = None
            for c in child:
                ct = local(c.tag)
                v = (c.text or '').strip()
                if ct == 'depth' and v:
                    d = float(v)
                elif ct == 'rank' and v:
                    r = int(v)
                elif ct == 'description' and v:
                    desc = rivers.get(v, v)
            if d is not None and (flood is None or d > flood[0]):
                flood = (d, r, desc)
            continue
        txt = (child.text or '').strip()
        if not txt:
            continue
        if t == 'measuredHeight':
            attrs['h'] = float(txt)
        elif t == 'usage' and 'usage' not in attrs:
            attrs['usage'] = txt
        elif t == 'name' and child.tag == GML + 'name':
            attrs['name'] = txt
        elif t == 'storeysAboveGround':
            attrs['floors'] = int(float(txt))
        elif t == 'storeysBelowGround':
            attrs['basement'] = int(float(txt))
        elif t == 'yearOfConstruction':
            attrs['year'] = int(float(txt))
        elif t == 'buildingStructureType':
            attrs['structure'] = txt
        elif t == 'totalFloorArea':
            attrs['area'] = float(txt)
    if flood:
        attrs['flood'] = flood[0]
        if flood[1] is not None:
            attrs['floodRank'] = flood[1]
        if flood[2]:
            attrs['floodRiver'] = flood[2]

    # LOD1 footprint: lowest flat polygon of the LOD1 solid (fallback LOD0)
    best = None
    zmax = None
    for tagname in ('lod1Solid', 'lod0FootPrint', 'lod0RoofEdge'):
        geom = el.find('.//' + BLDG + tagname)
        if geom is None:
            continue
        for pl in geom.iter(GML + 'posList'):
            pts = parse_poslist(pl.text)
            if len(pts) < 4:
                continue
            zs = [p[2] for p in pts]
            zmax = max(zs) if zmax is None else max(zmax, max(zs))
            if max(zs) - min(zs) > 0.05:
                continue
            if best is None or zs[0] < best[0]:
                best = (zs[0], pts)
        if best:
            break
    if not best:
        return None
    base, pts = best
    ring = []
    for lat, lon, _ in pts[:-1]:
        x, z = proj.xz(lat, lon)
        ring += [round(x, 1), round(z, 1)]
    n = len(ring) // 2
    cx = sum(ring[0::2]) / n
    cz = sum(ring[1::2]) / n
    if radius and math.hypot(cx, cz) > radius:
        return None
    height = attrs.get('h') or ((zmax or base) - base)
    if height <= 0:
        height = 3.0
    rec.update(attrs)
    rec['h'] = round(height, 1)
    rec['b'] = round(base, 1)
    rec['fp'] = ring

    if lod2:
        g = lod2_mesh(el, proj, base)
        if g:
            rec['g'] = g
    return rec


def lod2_mesh(el, proj, base):
    positions = []
    indices = []
    for surf in el.iter():
        if local(surf.tag) not in GEN_SURFACES or not surf.tag.startswith(BLDG):
            continue
        for poly in surf.iter(GML + 'Polygon'):
            ext = poly.find(GML + 'exterior')
            if ext is None:
                continue
            pl = ext.find('.//' + GML + 'posList')
            if pl is None:
                continue
            raw = parse_poslist(pl.text)
            if len(raw) < 4:
                continue
            pts = []
            for lat, lon, z in raw[:-1]:
                x, zz = proj.xz(lat, lon)
                pts.append((x, z - base, zz))
            # drop consecutive duplicates
            clean = [pts[0]]
            for p in pts[1:]:
                if max(abs(p[0] - clean[-1][0]), abs(p[1] - clean[-1][1]), abs(p[2] - clean[-1][2])) > 1e-3:
                    clean.append(p)
            if len(clean) < 3:
                continue
            tris = triangulate3d(clean)
            if not tris:
                continue
            off = len(positions) // 3
            for p in clean:
                positions += [round(p[0] * 10), round(p[1] * 10), round(p[2] * 10)]
            for a, b, c in tris:
                indices += [a + off, b + off, c + off]
    if not indices:
        return None
    return {'p': positions, 'i': indices}


def load_rivers(codelists):
    rivers = {}
    if not codelists:
        return rivers
    path = os.path.join(codelists, 'BuildingRiverFloodingRiskAttribute_description.xml')
    if not os.path.exists(path):
        return rivers
    tree = ET.parse(path)
    for d in tree.iter(GML + 'Definition'):
        name = d.find(GML + 'name')
        desc = d.find(GML + 'description')
        if name is not None and desc is not None:
            rivers[(name.text or '').strip()] = (desc.text or '').strip()
    return rivers


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('--id', default='')
    ap.add_argument('--name', default='')
    ap.add_argument('--origin', nargs=2, type=float, default=[35.6812, 139.7671])
    ap.add_argument('--radius', type=float, default=0)
    ap.add_argument('--lod2', action='store_true')
    ap.add_argument('--codelists', default='')
    a = ap.parse_args()
    proj = Projector(*a.origin)
    rivers = load_rivers(a.codelists)
    out = []
    for f in a.files:
        for _, el in ET.iterparse(f, events=('end',)):
            if el.tag == BLDG + 'Building':
                r = building_record(el, proj, a.radius, a.lod2, rivers)
                if r:
                    out.append(r)
                el.clear()
    data = {
        'id': a.id or os.path.splitext(os.path.basename(a.out))[0],
        'name': a.name,
        'origin': {'lat': a.origin[0], 'lon': a.origin[1]},
        'source': '3D都市モデル（Project PLATEAU）東京都23区（2022年度） 国土交通省',
        'count': len(out),
        'buildings': out,
    }
    with open(a.out, 'w', encoding='utf-8') as fp:
        json.dump(data, fp, ensure_ascii=False, separators=(',', ':'))
    lod2n = sum(1 for b in out if 'g' in b)
    print(f'wrote {a.out}: {len(out)} buildings ({lod2n} with LOD2), {os.path.getsize(a.out) / 1e6:.1f} MB')


if __name__ == '__main__':
    main()

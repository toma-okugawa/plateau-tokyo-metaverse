"""PLATEAU CityGML (bldg) -> compact JSON for the Three.js metaverse.

Usage: python scripts/convert_citygml.py <bldg.gml> [more.gml ...] -o public/data/area.json
       [--origin LAT LON] [--radius METERS]
"""
import argparse, json, math, xml.etree.ElementTree as ET

NS = {
    'gml': 'http://www.opengis.net/gml',
    'bldg': 'http://www.opengis.net/citygml/building/2.0',
    'core': 'http://www.opengis.net/citygml/2.0',
}
GML = '{http://www.opengis.net/gml}'
BLDG = '{http://www.opengis.net/citygml/building/2.0}'

def local(tag):
    return tag.rsplit('}', 1)[-1]

def to_xy(lat, lon, olat, olon):
    # Equirectangular projection around origin (accurate enough for a few km)
    x = (lon - olon) * 111320.0 * math.cos(math.radians(olat))
    y = (lat - olat) * 110574.0
    return x, y

def parse_poslist(text):
    v = [float(t) for t in text.split()]
    return [(v[i], v[i + 1], v[i + 2]) for i in range(0, len(v) - 2, 3)]

def building_record(el, olat, olon, radius):
    rec = {'id': el.get(GML + 'id')}
    attrs = {}
    floods = []
    for child in el.iter():
        t = local(child.tag)
        txt = (child.text or '').strip()
        if t == 'measuredHeight' and txt:
            attrs['h'] = float(txt)
        elif t == 'usage' and txt and 'usage' not in attrs:
            attrs['usage'] = txt
        elif t == 'name' and child.tag == GML + 'name' and txt:
            attrs['name'] = txt
        elif t == 'storeysAboveGround' and txt:
            attrs['floors'] = int(float(txt))
        elif t == 'storeysBelowGround' and txt:
            attrs['basement'] = int(float(txt))
        elif t == 'yearOfConstruction' and txt:
            attrs['year'] = int(float(txt))
        elif t == 'buildingStructureType' and txt:
            attrs['structure'] = txt
        elif t == 'depth' and txt:
            try:
                floods.append(float(txt))
            except ValueError:
                pass
        elif t == 'totalFloorArea' and txt:
            attrs['area'] = float(txt)
    if floods:
        attrs['flood'] = max(floods)

    # Footprint: lowest flat polygon of the LOD1 solid (fallback: LOD0)
    best = None
    for tagname in ('lod1Solid', 'lod0FootPrint', 'lod0RoofEdge'):
        geom = el.find('.//bldg:' + tagname, NS)
        if geom is None:
            continue
        for pl in geom.iter(GML + 'posList'):
            pts = parse_poslist(pl.text)
            if len(pts) < 4:
                continue
            zs = [p[2] for p in pts]
            if max(zs) - min(zs) > 0.05:
                continue
            if best is None or zs[0] < best[0]:
                best = (zs[0], pts, max(zs))
        if best:
            break
    if not best:
        return None
    base, pts, _ = best
    # roof height from solid
    zmax = base
    geom = el.find('.//bldg:lod1Solid', NS)
    if geom is not None:
        for pl in geom.iter(GML + 'posList'):
            for p in parse_poslist(pl.text):
                zmax = max(zmax, p[2])
    ring = []
    for lat, lon, _ in pts[:-1]:
        x, y = to_xy(lat, lon, olat, olon)
        ring += [round(x, 1), round(-y, 1)]  # three.js: +x east, -z north
    cx = sum(ring[0::2]) / (len(ring) // 2)
    cz = sum(ring[1::2]) / (len(ring) // 2)
    if radius and math.hypot(cx, cz) > radius:
        return None
    height = attrs.get('h') or (zmax - base)
    if height <= 0:
        height = 3.0
    rec.update(attrs)
    rec['h'] = round(height, 1)
    rec['b'] = round(base, 1)
    rec['fp'] = ring
    return rec

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('--origin', nargs=2, type=float, default=[35.6812, 139.7671])
    ap.add_argument('--radius', type=float, default=0)
    ap.add_argument('--name', default='')
    a = ap.parse_args()
    olat, olon = a.origin
    out = []
    for f in a.files:
        for ev, el in ET.iterparse(f, events=('end',)):
            if el.tag == BLDG + 'Building':
                r = building_record(el, olat, olon, a.radius)
                if r:
                    out.append(r)
                el.clear()
    data = {
        'name': a.name,
        'origin': {'lat': olat, 'lon': olon},
        'source': '3D都市モデル（Project PLATEAU）東京都23区（2022年度） 国土交通省',
        'count': len(out),
        'buildings': out,
    }
    with open(a.out, 'w', encoding='utf-8') as fp:
        json.dump(data, fp, ensure_ascii=False, separators=(',', ':'))
    print('wrote', a.out, len(out), 'buildings')

if __name__ == '__main__':
    main()

"""Build all metaverse areas from the PLATEAU Tokyo 23-ku CityGML archive.

1. Download 13100_tokyo23-ku_2022_citygml_1_2_op.zip from G空間情報センター
   (https://www.geospatial.jp/ckan/dataset/plateau-tokyo23ku-2022) into data/raw/
2. python scripts/build_data.py
   -> extracts the needed 3rd-level mesh files and writes public/data/<area>.json + areas.json
"""
import json
import os
import subprocess
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIP = os.path.join(ROOT, 'data', 'raw', '13100_tokyo23-ku_2022_citygml_1_2_op.zip')
PREFIX = '13100_tokyo23-ku_2022_citygml_1_2_op'
EXTRACT = os.path.join(ROOT, 'data', 'extract', 'full')
OUT = os.path.join(ROOT, 'public', 'data')

# id, display name, origin (lat, lon), radius (m), 3rd-level mesh codes, spawn [x, z], camera offset [dx, dy, dz]
AREAS = [
    {
        'id': 'marunouchi', 'name': '丸の内・東京駅', 'origin': (35.6812, 139.7671), 'radius': 900,
        'meshes': ['53394600', '53394601', '53394602', '53394610', '53394611', '53394612',
                   '53394620', '53394621', '53394622'],
        'start': [-185, 0], 'view': [230, 95, 70],
    },
    {
        'id': 'shibuya', 'name': '渋谷', 'origin': (35.6590, 139.7016), 'radius': 800,
        'meshes': ['53393585', '53393586', '53393595', '53393596'],
        'start': [-100, -55], 'view': [-90, 90, 150],
    },
    {
        'id': 'shinjuku', 'name': '新宿', 'origin': (35.6905, 139.6960), 'radius': 900,
        'meshes': ['53394514', '53394515', '53394516', '53394524', '53394525', '53394526',
                   '53394534', '53394535', '53394536'],
        'start': [226, -88], 'view': [170, 130, 140],
    },
]


def extract(meshes):
    with zipfile.ZipFile(ZIP) as z:
        names = set(z.namelist())
        wanted = [n for n in names if n.startswith(f'{PREFIX}/codelists/')]
        wanted += [f'{PREFIX}/udx/bldg/{m}_bldg_6697_2_op.gml' for m in meshes]
        for n in wanted:
            if n not in names:
                print(f'warning: {n} is not in the archive (no buildings in that mesh)')
                continue
            dest = os.path.join(EXTRACT, n)
            if n.endswith('/') or (os.path.exists(dest) and os.path.getsize(dest) == z.getinfo(n).file_size):
                continue
            z.extract(n, EXTRACT)


def convert(area):
    bldg = os.path.join(EXTRACT, PREFIX, 'udx', 'bldg')
    files = [os.path.join(bldg, f'{m}_bldg_6697_2_op.gml') for m in area['meshes']]
    cmd = [
        sys.executable, '-I', os.path.join(ROOT, 'scripts', 'convert_citygml.py'), *files,
        '-o', os.path.join(OUT, f"{area['id']}.json"), '--id', area['id'], '--name', area['name'],
        '--origin', str(area['origin'][0]), str(area['origin'][1]), '--radius', str(area['radius']),
        '--lod2', '--codelists', os.path.join(EXTRACT, PREFIX, 'codelists'),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    if r.returncode != 0:
        raise RuntimeError(f"{area['id']}: converter failed:\n{r.stderr}")
    return r.stdout.strip()


def main():
    os.makedirs(OUT, exist_ok=True)
    extract(sorted({m for a in AREAS for m in a['meshes']}))
    with ThreadPoolExecutor(len(AREAS)) as ex:
        for line in ex.map(convert, AREAS):
            print(line)
    index = [{'id': a['id'], 'name': a['name'], 'start': a['start'], 'view': a['view']} for a in AREAS]
    with open(os.path.join(OUT, 'areas.json'), 'w', encoding='utf-8') as fp:
        json.dump(index, fp, ensure_ascii=False, indent=2)
        fp.write('\n')


if __name__ == '__main__':
    main()

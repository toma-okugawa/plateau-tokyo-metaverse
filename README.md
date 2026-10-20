# TOKYO TWIN — PLATEAU 3D City Metaverse

国土交通省 [Project PLATEAU](https://www.mlit.go.jp/plateau/) の3D都市モデル（東京都23区 CityGML）を使い、Three.js で作ったブラウザで動くメタバース空間です。

**▶ デモ: https://toma-okugawa.github.io/plateau-tokyo-metaverse/**

## 機能
- 東京駅・丸の内エリアの実在の建物（PLATEAU LOD1）を実寸で再現
- アバターで街を歩ける（WASD / 矢印キー、Shiftで高速移動）
- 建物をクリックすると PLATEAU の属性（高さ・浸水想定など）を表示
- カラーモード切替：Aqua / 高さ / 洪水浸水リスク

## 開発
```bash
npm install
npm run dev
```

### データ変換
PLATEAU の CityGML（`udx/bldg/*.gml`）を軽量JSONに変換します。
```bash
python scripts/convert_citygml.py data/extract/53394611_bldg_6697_2_op.gml -o public/data/marunouchi.json --radius 900 --name "丸の内・東京駅"
```

## 出典・ライセンス
- 3D都市モデル：国土交通省 Project PLATEAU「3D都市モデル（Project PLATEAU）東京都23区（2022年度）」（[G空間情報センター](https://www.geospatial.jp/ckan/dataset/plateau-tokyo23ku-2022)）を加工して作成。利用条件は [PLATEAU Site Policy](https://www.mlit.go.jp/plateau/site-policy/) に従います。
- ソースコード：MIT License

作者：奥河董馬（弓削商船高専 情報工学科）

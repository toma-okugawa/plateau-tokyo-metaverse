# TOKYO TWIN — PLATEAU 3D City Metaverse

国土交通省 [Project PLATEAU](https://www.mlit.go.jp/plateau/) の3D都市モデル（東京都23区 CityGML）を使い、Three.js で作ったブラウザで動くメタバース空間です。

**▶ デモ: https://toma-okugawa.github.io/plateau-tokyo-metaverse/**

## 機能
| 機能 | 内容 |
| --- | --- |
| 実在の東京を歩ける | 丸の内・東京駅 / 渋谷 / 新宿 の3エリア。PLATEAU の **LOD2 建物モデル（屋根形状つき）** を実寸で配置（LOD2 が無い建物は LOD1 を押し出し） |
| アバター移動 | WASD / 矢印キー（Shift で高速）、スマホは画面右下のジョイスティック。建物の足元形状（フットプリント）で当たり判定 |
| ふわっと浮遊 | スペースキー長押し（スマホは「ふわっ」ボタン）で浮かび、離すとゆっくり降下。ビルの屋上にも着地できる |
| 建物の属性表示 | 建物をクリックすると PLATEAU の属性（計測高さ・地盤標高・想定浸水深・浸水ランク・対象河川 など）を表示 |
| カラーモード | Aqua / 高さ / 浸水リスク で建物を色分け |
| 洪水シミュレーション | PLATEAU の洪水浸水想定（`uro:BuildingRiverFloodingRiskAttribute`）を使い、水位を上げると水面が上昇。建物ごとの想定最大浸水深を国交省の配色の柱で可視化 |
| 時間帯 | 朝・昼・夕・夜を切替。夜は LOD2 建物の壁面に窓明かりが灯る |
| ミニマップ / ランドマーク | 周辺の建物を上から見た地図、名前付き建物の検索とワープ |

## 技術構成
- TypeScript + [Three.js](https://threejs.org/) + Vite
- GitHub Actions → GitHub Pages に自動デプロイ
- `src/main.ts` が世界（地面・アバター・建物・当たり判定・浮遊）を持ち、`src/features/*` の機能モジュールを `src/types.ts` の `Feature` 契約で差し込む構成
- 建物は約250m四方のチャンクに結合して描画（1エリア約40ドローコール）し、クリック判定用に建物ごとの非表示プロキシを保持
- 機能モジュールは codex（洪水シミュレーション）・agy（時間帯と夜景）・grok（ミニマップ・ランドマーク）が並行して実装

## 開発
```bash
npm install
npm run dev
```

### PLATEAU データの取得と変換
1. [G空間情報センター「3D都市モデル（Project PLATEAU）東京都23区（2022年度）」](https://www.geospatial.jp/ckan/dataset/plateau-tokyo23ku-2022) から CityGML（`13100_tokyo23-ku_2022_citygml_1_2_op.zip`, 約5.6GB）を `data/raw/` に保存
2. 変換（必要な3次メッシュだけを展開し、`public/data/<エリア>.json` を生成）
   ```bash
   python scripts/build_data.py
   ```
   `scripts/convert_citygml.py` が CityGML の建物（`bldg:Building`）を読み、LOD2 の屋根・壁面ポリゴンを三角形分割して軽量 JSON に変換します。

## 出典・ライセンス
- 3D都市モデル：国土交通省 Project PLATEAU「3D都市モデル（Project PLATEAU）東京都23区（2022年度）」（[G空間情報センター](https://www.geospatial.jp/ckan/dataset/plateau-tokyo23ku-2022)）を加工して作成。利用条件は [PLATEAU Site Policy](https://www.mlit.go.jp/plateau/site-policy/) に従います。
- ソースコード：MIT License

作者：奥河董馬（弓削商船高専 情報工学科）

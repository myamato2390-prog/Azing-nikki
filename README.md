# お豆日記（Aji-Nikki）

画面に出るアプリ名は「お豆日記」（v0.2.1 で「アジ日記」から変更）。端末内の保存先（IndexedDB `aji-nikki`）・バックアップの `app: 'aji-nikki'`・記録の `kind: 'aji'` は変えていない（変えると記録が読めなくなるため）。

アジング専用の釣行日記・記録手帳アプリ（Android向け PWA）。仕様は [SPEC.md](SPEC.md)。

鮎日記（[Ayu-Nikki](https://github.com/myamato2390-prog/Ayu-Nikki) v1.2）のコードを土台にしています。
同じ `github.io` 上で動いてもデータが混ざらないよう、端末内の保存先（IndexedDB `aji-nikki`）・キャッシュ名・アプリ名・アイコンを分けています。

## できること

- **釣り物はアジとタチウオ**。入力画面の先頭で「アジ／タチウオ／両方」を選ぶ。「両方」の日はアジとタチウオで別々のカード・別々の記録になり、集計も別々（カードの見出しはアジ＝金、タチウオ＝銀）
- タチウオは、サイズごとの匹数（F6以上〜F3未満）、仕掛け（テンヤ・フリーフォール、テンヤの重さ）、餌（ドジョウ・キビナゴ・イワシ・サンマ・ハイブリッドクロスの硬さ）、レンジ・誘い方を記録

- **1釣行＝1枚のカード**（1画面に収まる密度）。横スワイプで前後の釣行に切り替え。港ごとに色が変わる
- **釣行前／釣行後** の2タブで入力。入力のたびに自動保存。夜釣りで日付をまたいでも記録できる（18:30〜翌02:00）
- 佐田岬まわりの港を、瀬戸内側／宇和海側に分けてワンタップ選択
- **潮回り・満潮・干潮のめやす**を自動計算（電波不要。瀬戸内側＝松山、宇和海側＝宇和島の気象庁の調和定数から）
- **天気・風・気温の自動入力**（釣りの時間帯の予報。Open-Meteo）
- ジグヘッド・ワーム・レンジ・誘い方は **使った／★良かった** を記録。外道は名前だけ
- **作戦ボード**（似た条件の過去の釣行と★）、**港の過去成績**、**自己ベストのお祝い**と🏆
- **検索**、**年ごとのまとめ**（画面・Excel・まとめ画像）、カード画像の**LINE共有**
- **バックアップ**：JSONで書き出し・読み込み（読み込んでも今ある記録は消えない）
- 暗い画面（夜釣り向け）と明るい画面の切り替え。オフライン動作

データはすべてスマホの中（IndexedDB）に保存され、外部には送信しません。

## テスト版

- 本番：`https://myamato2390-prog.github.io/Azing-nikki/`（main）
- テスト版：`https://myamato2390-prog.github.io/Azing-nikki/preview/`（最後に push した作業ブランチ）。記録は本番とは別の場所に保存される
- 公開は GitHub Actions（`.github/workflows/pages.yml`）。Settings → Pages の Source を「GitHub Actions」にしておく

## 開発

ビルド不要の素の HTML / CSS / JavaScript（ES Modules）です。

```bash
python3 -m http.server 8000   # http://localhost:8000 で確認
node --test tests/*.test.mjs  # テスト
node tools/make-icons.mjs     # アイコンの作り直し（tools/icon.svg から。Playwright が必要）
```

ファイルを変更したら `sw.js` の `VERSION` を上げてください（オフライン用キャッシュの更新）。

| ファイル | 役割 |
|---|---|
| `js/app.js` | 画面（カード・入力・検索・まとめ・設定） |
| `js/model.js` | データ項目・選択肢・共通処理（鮎日記と共通の項目＋ `trip.aji`） |
| `js/tide.js` | 潮の計算（潮回り・満潮・干潮）。`tests/data/` は検証用の気象庁の潮位表 |
| `js/weather.js` | 天気・風・気温の自動入力（Open-Meteo） |
| `js/insights.js` | 作戦ボード・港の成績・自己ベスト |
| `js/search.js` / `js/stats.js` | 検索 / 集計・★ランキング |
| `js/export.js` / `js/xlsx.js` | Excel出力（ライブラリなし） |
| `js/share.js` | カード画像・まとめ画像の作成とLINE共有 |
| `js/db.js` | 端末内保存（IndexedDB） |
| `sw.js` / `manifest.webmanifest` | オフライン対応・ホーム画面アプリ化 |

# アジ日記（Aji-Nikki）

アジング専用の釣行日記・記録手帳アプリ（Android向け PWA）。仕様は [SPEC.md](SPEC.md)。

鮎日記（[Ayu-Nikki](https://github.com/myamato2390-prog/Ayu-Nikki) v1.2）のコードを土台にしています。
同じ `github.io` 上で動いてもデータが混ざらないよう、端末内の保存先（IndexedDB `aji-nikki`）・キャッシュ名・アプリ名・アイコンを分けています。

データはすべてスマホの中（IndexedDB）に保存され、外部には送信しません。

## 開発

ビルド不要の素の HTML / CSS / JavaScript（ES Modules）です。

```bash
python3 -m http.server 8000   # http://localhost:8000 で確認
node --test tests/*.test.mjs  # テスト
node tools/make-icons.mjs     # アイコンの作り直し（tools/icon.svg から。Playwright が必要）
```

ファイルを変更したら `sw.js` の `VERSION` を上げてください（オフライン用キャッシュの更新）。

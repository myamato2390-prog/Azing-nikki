// カードの保管場所（Firebase の Firestore）。短いリンクでカードを送るために使う。
// ここの値は「どの保管場所か」を表す公開の名前で、秘密の鍵ではない（アプリに入れて配るもの）。
// 読み書きできる範囲は Firebase 側のルールでしぼる（SPEC.md 6-2）。
// 空のままなら、カードは保管せず、長いリンクで送る
export const SHARE = {
  projectId: 'omame-nikki',
  databaseId: 'omame-nikki', // Firestore のデータベースの名前（初期値の (default) ではない）
  apiKey: 'AIzaSyBhz07lEFkNbBH1xZbrmFgplur0B8jHfMI',
};

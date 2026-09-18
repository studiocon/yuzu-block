# yuzu-block (working title)

## ブランド制約（違反はバグ）

以下の日本語をコード・コメント・README・package.json 等どこにも使わない:
癒し、寄り添う、育つ、やさしく、ふんわり。

英語でも "grow/growth/nurture/heal/gentle/soothing/reward/streak/celebrate" を
文章・識別子に使わない。

文体（コメント・description含む）は cool / documentary / declarative。
励まし・称賛・温かみのある表現は禁止。データは記録されるだけで、祝われない。

最終的な製品名はどこにも書かない。"this project" または
`yuzu-block (working title)` とだけ呼ぶ。

## UI / データのルール

- 彫刻（canvas）上にテキスト・数値・ラベルを出さない。ページのクローム（ロゴ・リード文・フッター）は
  `lib/copy.ts` の定数のみ。計測値・カウント・ストリークは表示しない。
- 初期表示はスナップショットの約 90%。以後、非表示にしていたブロックを 1 個ずつ現し、セル単位で
  色階層を入れ替える。スナップショットを超えて増やさない。光・音・数値・祝福演出は禁止。
  prefers-reduced-motion では静止。
- ユーザー単位のフィールド（streak、連続日数、user id 等）を一切持たない。
  匿名の集計値のみ。
- 色・トークンは必ず `lib/palette.ts` から参照する（直書きしない）。

## 作業フロー

着手前に `.claude/lessons/` を読むこと。過去セッションで一度払った代償が
書いてある（描画のちらつき、シェーダの罠、デプロイ状態の誤読、テストの作法）。
セッションをまたいで役立つ学びはそこに追記する。書き方は
`.claude/lessons/README.md` に従う。

タスクを完了とみなす前に必ず `npm run check`
（typecheck && lint && test && check:brand）を通すこと。

デプロイ状態は `npm run deploy:status` で確認する。GitHub はチェックが
存在しないコミットも `pending` と返すため、`state` だけを見ると「取りこぼし」と
「ビルド中」を取り違える。

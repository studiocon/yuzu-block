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

- 画面上にテキスト・数値・ラベルを一切出さない。
- 積み上がっていくビルドアップ演出をしない。
- ユーザー単位のフィールド（streak、連続日数、user id 等）を一切持たない。
  匿名の集計値のみ。
- 色・トークンは必ず `lib/palette.ts` から参照する（直書きしない）。

## 作業フロー

タスクを完了とみなす前に必ず `npm run check`
（typecheck && lint && test && check:brand）を通すこと。

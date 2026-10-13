# Awesome Copilot 公開準備

## 提案内容

このスキルは、Mermaidコードフェンスを含むMarkdown文書をDOCXへ変換する。Mermaid CLIでSVGを描画し、Word文書にSVGとPNGフォールバックを格納する。SVGのOffice OOXML関連付け、HTMLラベルによる文字欠落の回避、縦長図の改ページと縮小を扱う。

既存の `md-to-docx` は、Markdown本文と既存PNG画像をWordへ変換する汎用用途を扱う。本スキルはMermaidソースからの描画、ベクターSVGの格納、図のページ配置に焦点を絞る。SVGの埋め込みは、Word上で図形・線・文字を個別編集できることを意味しない。

## 投稿案

Title:

```text
Add Mermaid-to-Word SVG export skill
```

Description:

```text
Export Markdown documents with Mermaid diagrams to Word, preserving vector SVGs with PNG fallbacks and page-aware placement.
```

Summary:

```text
This skill converts Markdown documents containing Mermaid code fences into Word documents. It renders diagrams locally with Mermaid CLI, embeds SVG through Office OOXML relationships, retains PNG fallbacks, and keeps large diagrams together with page-aware placement. It is intended for technical documents that need readable diagrams in DOCX, not general Markdown conversion or editable Office shapes.
```

## 評価ケース

| 入力・依頼 | 期待結果 |
| --- | --- |
| Mermaidフロー図を含む設計書をWordへ出力 | 本スキルを選び、DOCXにSVGとPNGを格納する |
| 縦長のMermaid図を含む手順書をWordへ出力 | 図を段落間で分割せず、必要に応じて改ページ・縮小する |
| PNG画像だけを含む一般的なMarkdownをWordへ変換 | Mermaid固有の機能が不要なら汎用変換スキルを候補にする |
| Word上でMermaid図の各図形やラベルを編集したい | 本スキルは図形編集を保証しないと説明し、適合する別手段を案内する |
| Mermaid CLIまたは描画に必要なブラウザーがない | 前提条件を示し、描画またはインストール前に停止する |

## 投稿前の確認

- Awesome Copilotの現行投稿手順に沿い、skill作成・検証コマンドを投稿先リポジトリ上で実行する。
- 匿名サンプルを含め、公開物に顧客情報、社内パス、認証情報がないことを確認する。
- 依存パッケージのライセンスと同梱コードの権利を確認する。
- 投稿先の貢献規約により変更はMITライセンスで提供されるため、権利者が同条件での提供を承認できることを確認する。
- 実描画テスト、DOCX内のSVG・PNG・ラベル検査、Wordでの目視確認を別々に記録する。自動テストの合格をWord表示の受入に読み替えない。
- 投稿先リポジトリでskillの作成・検証を行い、生成READMEを更新してからPRを作成する。公開操作は別途承認を得て行う。

## 現在の確認状況

- `assets/example.md` は架空の英語・日本語ラベルを使い、承認フロー、縦長図、通常のMarkdown表を含む。
- Mermaid CLIを模擬する5件、サンプルを実描画する1件、既存DOCXの上書き防止を確認する1件の計7件が合格した。実描画では3図のSVG参照、PNG格納、英語・日本語ラベル、図の寸法を検査した。
- Word 16.0でDOCXを読み取り専用で開き、PDFの全3ページを画像で目視確認した。英日ラベル、分岐線、図全体の収まりを確認し、元DOCXのハッシュは不変だった。縦長図は2ページ目に収まるが、見出しは1ページ目に残る。分岐ラベルの背後に接続線が見える箇所もある。Wordの操作画面での拡大確認と実機印刷は未実施である。
- 別コンテキストの担当が、スキル本文を読まずに行う実行と、本文を読んで行う実行を比較した。本文ありの再実行では正常変換、既存出力への上書き拒否、不正Mermaidでの停止、編集可能なWord図形が対象外であることの説明を確認した。本文なしでも同梱変換器による変換・停止は成功しており、本文ありの変換品質向上は主張しない。自動スキル選択は評価していない。
- 本文ありの実行は一度170秒でタイムアウトした。300秒上限での再実行は約100秒で完了したが、前回の原因は未確認であり、性能改善とは扱わない。
- 投稿先 `github/awesome-copilot` のコミット `156736fb63e965b2f547a1460f3b5972c46e6b24` を固定し、候補を含む430スキルの `npm run skill:validate` と `npm run build` が終了コード0で完了した。これはローカルでの公式コマンド実行結果であり、投稿後のCIやメンテナー承認ではない。

## ライセンスと公開権限

2026年10月13日、利用者がスキル自身のコード・文書・サンプルの権利保有と承認権限を確認し、MIT提供を承認した。これは利用者の確認に基づく記録であり、AIが権利関係を法的に確定したものではない。作業領域はGit管理外であり、作者・転載元を履歴から追跡できなかった。

実行環境のライセンス本文とメタデータを確認した。`python-docx`、`markdown-it-py`、`mdurl`、Mermaid CLI、MermaidはMIT、`lxml` はBSD-3-Clause、`typing-extensions` はPSF-2.0である。PuppeteerのパッケージメタデータはApache-2.0だが、今回のインストール先でライセンス本文は確認できなかった。`lxml` の同梱物にも個別条件があるため、ライブラリ全体をMITへ変更できるとは解釈しない。

投稿候補には依存ライブラリ本体、ブラウザー、フォント、DOCX、実行ログを同梱しない。フォントも文書へ埋め込まない。同梱する範囲を将来変える場合は、その範囲の再配布条件を別途確認する。公開、push、PR作成は未実施である。

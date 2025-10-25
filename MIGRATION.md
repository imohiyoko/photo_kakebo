# Migration Plan: Monolithic server.js -> Modular Backend

## 対応表
| Legacy (db-kakebo/server.js) | New (apps/backend) |
|-----------------------------|--------------------|
| /upload, /upload_multi      | routes/ocr.js      |
| /api/save                   | routes/entries.js  |
| /api/entries, /api/entries/:id/confirm | routes/entries.js |
| /api/edit-stats, /api/improvement-candidates | routes/entries.js |
| /api/user/flags*, /api/llm/optin | routes/flags.js |
| /api/training/*             | routes/training.js |
| /api/llm/model/latest, /api/llm/logs | routes/llm.js |
| Stub OCR endpoints          | routes/ocr.js      |
| LLM解決ロジック             | services/ocrUtils.js (callLLMConflicts) |
| 差分抽出/匿名化             | services/diff.js   |
| DBスキーマ初期化            | infra/db.js        |

## 移行フェーズ
### Phase 0 (現状)
- 並行稼働: 3000 (legacy) / 3001 (modular)
- フロントは徐々に 3001 に切替

### Phase 1: Read-only Legacy
- 旧サーバーの書き込み系 (/api/save, confirm, training/upload) を 302 Redirect or 503 で停止
- ログに "READ-ONLY LEGACY" 警告追加

### Phase 2: Hard Disable
- 旧 server.js 起動時に即終了 (KEEP_LEGACY=1 の場合のみ許可)

### Phase 3: Removal
- リポジトリから `db-kakebo/server.js` を削除
- README から legacy 記述除去

## フロント切替手順
1. `frontend/script.js` 内 fetch('http://localhost:3000/...') を 3001 に変更。
2. 管理コンソール `admin/index.html` も同様。
3. 動作確認後 Phase 1 移行。

## 既知差異 / 注意点
- 新バックエンドは uploads ディレクトリのパス差異がない想定だが、実際の処理ルート基準 path.join(process.cwd(),'uploads') に統一。
- LLMバックエンドの latency 計測は新構成でのみ記録精度改善予定。
- 旧サーバーに残る auto-dict ロード処理は新 services/ocrUtils.js に集約済み。

## チェックリスト (完了条件)
- [x] 全フロントのポート切替 (2025-10-25)
- [ ] エクスポート/評価スクリプトが新APIで動作
- [ ] LLMログが新バックエンドのみで増加
- [ ] training_data への挿入が新経路のみ
- [ ] Legacy削除後 CI/テスト成功

## ロールバック指針
- 問題発生時は KEEP_LEGACY=1 で旧サーバー再起動し挙動比較。
- 差分は llm_logs / training_data の entry_id 一致で追跡。

---
これに沿って段階的削除を進めてください。

### Phase 1 適用状況 (2025-10-25)
- legacy `/upload`, `/upload_multi`, `/api/save`, `/api/entries/:id/confirm`, `/api/training/upload` は 503 を返し read-only 化
- フロント (`frontend/script.js`) と管理コンソール (`admin/index.html`) は port 3001 へ切替完了
- `KEEP_LEGACY_WRITE=1` を設定すると一時的に旧書込を再有効化可能

次ステップ: Phase 2 Hard Disable の準備 (起動ガード + KEEP_LEGACY=1 例外) と新サーバ側で追加の監視/テスト導入。

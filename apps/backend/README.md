# Backend (API)

予定: 現在の `db-kakebo/server.js` をここへ段階的に分割移行。

推奨フォルダ:
```
apps/backend/
  src/
    routes/
    services/
    infra/
  package.json
```

移行ステップ:
1. 既存 server.js を複製し TypeScript 化検討。
2. OCR, LLM, training, flags を routes/* に分離。
3. services 層で OCR/LLMバックエンド抽象。
4. infra 層で DB 接続ファクトリ。

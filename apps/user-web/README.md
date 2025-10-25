# User Web (Frontend)

現状: `frontend/` ディレクトリに index.html / script.js / style.css。

将来移行:
1. この `apps/user-web/` 下に SPA フレームワーク (React/Vite) 導入可能。
2. API 呼び出しは /upload, /upload_multi, /api/* を利用。
3. モデルバージョン通知 / WebSocket による新パッチ案内など検討。

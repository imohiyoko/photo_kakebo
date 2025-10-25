# Photo Kakebo Architecture

## 目的
OCR / LLM / 学習データ収集 / 管理コンソールを疎結合化し、後からエンジン入替・スケールアウト可能な構成を確立する。

## 推奨ディレクトリ構造
```
photo_kakebo/
  apps/
    backend/              # Node.js API (server.jsを将来分割: routes/, services/ など)
    user-web/             # 一般ユーザーWeb UI (現: frontend/ の移行先)
    admin/                # 管理コンソール (現: admin/ 移行先)
    llm-service/          # Python FastAPI (現: llm/service)
    ocr-preprocess/       # Python 前処理 (crop_receipt.py 等を集約予定)
  services/               # 共通サービスレイヤ (将来: OCR抽象, LLM呼び出しラッパ)
  scripts/                # データ抽出・評価・辞書更新 (extract_conflicts.js 等)
  data/
    models/               # 配布済み量子化モデル/LoRA差分
    dictionaries/         # ocr_autocorrect.json 等
    raw/                  # 元レシート画像(実際は外部ストレージ推奨)
  config/
    env.example           # 環境変数テンプレート
    routes.map.json       # APIルーティング定義 (将来)
  logs/                   # llm_logs, アプリ運用ログ (SQLite→外部DB移行後)
  ARCHITECTURE.md         # この文書
  README.md
```

## モジュール分割方針
- API層: Expressで各 concern を route 毎に分離 (`routes/ocr.js`, `routes/training.js`, `routes/llm.js`).
- Service層: OCRエンジン抽象 (`OcrEngineInterface`), LLMバックエンド抽象 (`LlmBackendInterface`).
- Infra層: DB接続, ファイルストレージ, キャッシュ層 (将来: Redis / MinIO / S3など)。

## データフロー概要
1. user-web が画像アップロード → backend `/upload` or `/upload_multi`
2. backend が前処理 (Python) 呼び出し → OCRエンジン複数 → 集約/衝突抽出
3. LLMバックエンド (stub|ollama|transformers) 衝突解消
4. ユーザー修正確定 → 差分ログ & (opt-in条件) training_data へ
5. 管理側: admin で pending 確認 → export / 学習 → 新モデル差分を data/models へ配置
6. backend `/api/llm/model/latest` で配布済みモデルメタを照会 → user-web 通知

## 今後の段階的リファクタ手順
1. `db-kakebo/server.js` を `apps/backend/` に複製 → routes 分割 → 旧ファイル廃止
2. `frontend/` と `admin/` を `apps/user-web/`, `apps/admin/` に移動
3. スクリプト類を `scripts/` 下へ移動し README に利用方法整理
4. SQLite → PostgreSQL/Cloud DB 移行 (接続層抽象化)
5. モデルファイル配布 (HTTP + バージョン署名) 向け `models/` 構成整備
6. テスト (`jest` / `pytest`) 導入: service層単体テスト + route統合テスト

## 依存ポリシー
- 上位レイヤ (route) は下位レイヤ (service) の抽象インターフェースにのみ依存。
- service層は infra 実装へ依存するが、interface差し替えでモック化容易に。

## 環境変数 (env.example 推奨)
```
PORT=3000
PREPROCESS_API_URL=http://localhost:5001/crop_receipt
LLM_BACKEND=stub
LLM_API_URL=http://localhost:8000
LLM_MODEL=llama3
LLM_MODEL_VERSION=ocr_conflict_v1
PADDLE_OCR_API_URL=http://localhost:6001/paddle
TROCR_API_URL=http://localhost:6002/trocr
```

## 将来の削除/統合候補
- `extract_conflicts.js` と `export_edits.js` → 単一 `scripts/build_training_dataset.js` へ統合。
- `update_ocr_dict.js` → OCR正規化パイプライン内へ自動組み込み。

## 移行戦略上の注意
- 先に複製→新ルートで動作検証→古いディレクトリ削除の段階的移行。
- パス変更はフロントの fetch URL に影響するため、互換エイリアス `/legacy/*` を一定期間残す。
- モデル/辞書ファイルは git 管理サイズ肥大化防止のため外部(リリースバイナリ or オブジェクトストレージ)へ分離推奨。

## 品質担保
- ルーティング分割後は ESLint / TypeScript 化。
- 衝突解消ロジックはスナップショットテスト (入力 conflictsPayload → 出力 resolutions) を追加。

---
今後この構造に沿って段階的にファイル移動と再編を進められます。次に「routes 分割」か「scripts 移動」どちらを優先するか選択してください。

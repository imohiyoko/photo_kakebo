# Photo Kakebo

レシートの写真をアップロードするだけで、簡単に家計簿がつけられるWebアプリケーションです。OCR技術を利用して、画像からテキストを自動で読み取ります。

## ✨ 機能一覧

-   **レシート画像のアップロード**: PCやスマートフォンからレシートの画像ファイルをアップロードできます。
-   **OCRによるテキスト抽出**: アップロードされた画像を解析し、テキスト情報を抽出します。
-   **データ編集・保存**: 抽出されたテキストを元に、店舗名、購入日、合計金額などを修正し、データベースに保存できます。
-   **家計簿データの一覧表示**: 保存した家計簿データを一覧で確認できます。

## 🛠️ 技術スタック

### フロントエンド
-   HTML5
-   CSS3
-   Vanilla JavaScript

### バックエンド
-   Node.js / Express
-   Multer (ファイルアップロード)
-   Tesseract.js (OCRエンジン)
-   PaddleOCR / TrOCR (オプション・マルチOCR集約)
-   SQLite3 (データベース)
-   FastAPI (LLM衝突解決サービス)

### AI/LLM / OCR 強化
-   マルチOCR結果の行単位多数決 + 衝突検出
-   LLMによる不一致行の補完（`LLM_API_URL` が設定されている場合）
-   ユーザー修正差分ログから辞書自動生成 / 微調整用データ抽出

## 🚀 環境構築と実行方法（基本 / Phase3 以降）

Phase3 移行によりレガシー `db-kakebo/server.js` は削除され、モジュール化バックエンドへ統合されました。

1. **リポジトリをクローンします。**
    ```bash
    git clone https://github.com/imohiyoko/photo_kakebo.git
    cd photo_kakebo
    ```

2. **依存関係をインストールします。** (新バックエンドは `apps/backend/src/server.js` で動作します)
    ```bash
    npm install
    ```

3. **バックエンドを起動します。**
    ```bash
    npm start
    ```
    デフォルトで `PORT=3001` のため `http://localhost:3001` が API 入口になります。
    SQLite ファイルや `uploads` ディレクトリは初回起動時に自動生成されます。

4. **フロントエンドを開きます。**
    ルートの `frontend/index.html` をブラウザで開くか、後続で SPA 化予定の `apps/user-web/` へ移行していく計画です。

## 🔁 マルチOCR + LLM を有効にする

1.  必要な追加OCRサービス（例: PaddleOCR API, TrOCR API）を別プロセスで起動し、以下を .env に設定:
    ```env
    PADDLE_OCR_API_URL=http://localhost:5003/ocr_paddle
    TROCR_API_URL=http://localhost:5004/ocr_trocr
    LLM_API_URL=http://localhost:8001
    ```
2.  LLMサービス（FastAPIスタブ）起動例:
    ```bash
    cd db-kakebo/llm/service
    pip install -r requirements.txt
    uvicorn app:app --host 0.0.0.0 --port 8001
    ```
3.  フロントで「LLM補完を使用」チェック + マルチOCRボタンを押すと衝突行がLLMへ送信され結果が統合されます。

## 📦 追加スクリプト

| スクリプト | 目的 |
|------------|------|
| `db-kakebo/update_ocr_dict.js` | 頻出置換から自動補正辞書生成 |
| `db-kakebo/export_edits.js` | 過去7日編集ログをCSV出力 |
| `db-kakebo/extract_conflicts.js` | 衝突行を学習用JSONLに抽出 |

例: 衝突学習データ生成
```bash
cd db-kakebo
node extract_conflicts.js > conflict_train.jsonl
``` 

## 🧪 LLM 微調整（概要）

1. `conflict_train.jsonl` を整形（重複除去・PIIマスク）
2. QLoRA設定でベースモデル (例: Llama 3 8B) にアダプタ学習
3. 評価セット (開発用 JSONL) で EM / F1 / レイテンシ確認
4. `adapters/` に保存し `ACTIVE_LORA` 環境変数で切替（将来拡張）

## ⚙️ 主な環境変数 (.env)
```env
PREPROCESS_API_URL=http://localhost:5001/crop_receipt
PADDLE_OCR_API_URL= (任意)
TROCR_API_URL= (任意)
LLM_API_URL= (任意)
```

`LLM_API_URL` 未設定時はヒューリスティック（最長候補）で衝突解決します。

## 📁 ディレクトリ構成（抜粋 / 更新後）

```
.
├── apps/
│   ├── backend/              # 新バックエンド (分割済み Express ルート構成)
│   │   └── src/
│   │       ├── server.js     # エントリ (PORT=3001)
│   │       ├── routes/       # entries.js, ocr.js, llm.js など
│   │       ├── services/     # diff.js, ocrUtils.js (今後抽象化予定)
│   │       └── infra/        # db.js (DB接続と初期化)
│   ├── admin/                # 管理コンソール (移行途中)
│   └── user-web/             # 一般ユーザーWeb (frontend/ から段階的移行予定)
│
├── db-kakebo/                # レガシー残存スクリプト置き場（server.js は削除済）
│   ├── extract_conflicts.js
│   ├── update_ocr_dict.js
│   ├── export_edits.js
│   └── llm/service/app.py    # FastAPI LLM 衝突解決スタブ（将来 apps/llm-service/ へ）
│
├── frontend/                 # 旧フロント (静的) 段階的に apps/user-web/ へ移行
├── ARCHITECTURE.md
├── package.json
└── README.md
```

レガシーAPIサーバは削除済みのため、`db-kakebo/server.js` を参照する古い手順・ポート 3000 は利用しないでください。
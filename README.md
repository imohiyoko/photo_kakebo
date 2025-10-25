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

## 🚀 環境構築と実行方法（基本）

1.  **リポジトリをクローンします。**
    ```bash
    git clone https://github.com/imohiyoko/photo_kakebo.git
    cd photo_kakebo
    ```

2.  **バックエンドの依存関係をインストールします。**
    ```bash
    cd db-kakebo
    npm install
    ```

3.  **バックエンドサーバーを起動します。**
    ```bash
    npm start
    ```
    サーバーが `http://localhost:3000` で起動します。
    データベースファイル (`kakebo.db`) やアップロード用のディレクトリ (`uploads`) は、初回起動時に自動で作成されます。

4.  **フロントエンドを開きます。**
    ルートの `frontend/index.html` をブラウザで開きます。

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

## 📁 ディレクトリ構成（抜粋）

```
.
├── db-kakebo/         # バックエンド (Node.js/Express + OCR集約 + LLM連携)
│   ├── node_modules/
│   ├── uploads/       # アップロードされた画像が保存される
│   ├── kakebo.db      # SQLiteデータベースファイル
│   ├── package.json
│   ├── server.js      # APIサーバー本体
│   ├── extract_conflicts.js # 衝突行学習データ抽出
│   ├── update_ocr_dict.js   # 自動補正辞書生成
│   ├── llm/service/app.py   # FastAPI LLM衝突解決スタブ
│
├── frontend/          # フロントエンド
│   ├── index.html
│   ├── script.js
│   └── style.css
│
├── .gitignore
└── README.md
```
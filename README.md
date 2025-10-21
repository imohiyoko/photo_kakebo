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
-   Node.js
-   Express
-   Multer (ファイルアップロード)
-   Tesseract.js (OCRエンジン)
-   SQLite3 (データベース)

## 🚀 環境構築と実行方法

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
    プロジェクトのルートにある `frontend/index.html` ファイルを直接ブラウザで開いてください。

## 📁 ディレクトリ構成

```
.
├── db-kakebo/         # バックエンド (Node.js/Express)
│   ├── node_modules/
│   ├── uploads/       # アップロードされた画像が保存される
│   ├── kakebo.db      # SQLiteデータベースファイル
│   ├── package.json
│   └── server.js      # APIサーバー本体
│
├── frontend/          # フロントエンド
│   ├── index.html
│   ├── script.js
│   └── style.css
│
├── .gitignore
└── README.md
```
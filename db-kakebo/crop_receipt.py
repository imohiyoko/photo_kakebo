import cv2
import numpy as np
from flask import Flask, request, send_file, jsonify
import tempfile
import os

app = Flask(__name__)

# レシート領域自動切り出し＋アスペクト比維持リサイズ
# POST /crop_receipt で画像を受け取り、前処理済み画像を返す
@app.route('/crop_receipt', methods=['POST'])
def crop_receipt():
    if 'image' not in request.files:
        return jsonify({'error': 'No image uploaded'}), 400
    file = request.files['image']
    npimg = np.frombuffer(file.read(), np.uint8)
    img = cv2.imdecode(npimg, cv2.IMREAD_COLOR)
    if img is None:
        return jsonify({'error': 'Invalid image'}), 400

    # --- レシート領域推定（台形補正付き） ---
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5,5), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY+cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    crop = img
    best_rect = None
    best_score = 0
    img_area = img.shape[0] * img.shape[1]
    for c in contours:
        area = cv2.contourArea(c)
        if area < img_area * 0.05:  # 面積が画像の5%未満は除外（大きめ閾値）
            continue
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.04 * peri, True)  # 許容誤差大きめ
        if len(approx) == 4:
            pts = approx.reshape(4,2)
            # 縦横比チェック（レシートらしい縦長 or 横長）
            x, y, w, h = cv2.boundingRect(pts)
            aspect = h / w if w > 0 else 0
            if 1.5 < aspect < 10:  # 縦長（大きめ許容）
                score = area * aspect  # 面積×縦横比でスコア
                if score > best_score:
                    best_score = score
                    best_rect = pts
    if best_rect is not None:
        # 四隅検出→台形補正
        def order_points(pts):
            rect = np.zeros((4,2), dtype="float32")
            s = pts.sum(axis=1)
            rect[0] = pts[np.argmin(s)]
            rect[2] = pts[np.argmax(s)]
            diff = np.diff(pts, axis=1)
            rect[1] = pts[np.argmin(diff)]
            rect[3] = pts[np.argmax(diff)]
            return rect
        rect = order_points(best_rect)
        (tl, tr, br, bl) = rect
        widthA = np.linalg.norm(br - bl)
        widthB = np.linalg.norm(tr - tl)
        maxWidth = int(max(widthA, widthB))
        heightA = np.linalg.norm(tr - br)
        heightB = np.linalg.norm(tl - bl)
        maxHeight = int(max(heightA, heightB))
        dst = np.array([
            [0,0],
            [maxWidth-1,0],
            [maxWidth-1,maxHeight-1],
            [0,maxHeight-1]
        ], dtype="float32")
        M = cv2.getPerspectiveTransform(rect, dst)
        crop = cv2.warpPerspective(img, M, (maxWidth, maxHeight))
    elif contours:
        # 最も大きい輪郭で矩形トリミング
        c = max(contours, key=cv2.contourArea)
        x, y, w, h = cv2.boundingRect(c)
        crop = img[y:y+h, x:x+w]

    # --- 横幅基準でアスペクト比維持リサイズ ---
    target_width = 600
    h0, w0 = crop.shape[:2]
    scale = target_width / w0
    target_height = int(h0 * scale)
    resized = cv2.resize(crop, (target_width, target_height), interpolation=cv2.INTER_CUBIC)

    # 一時ファイルに保存して返却
    with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as tmp:
        cv2.imwrite(tmp.name, resized)
        tmp_path = tmp.name
    return send_file(tmp_path, mimetype='image/jpeg')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)

document.addEventListener('DOMContentLoaded', () => {
    const imageInput = document.getElementById('receiptImage');
    const imagePreview = document.getElementById('imagePreview');
    const uploadButton = document.getElementById('uploadButton');
    const ocrResult = document.getElementById('ocrResult');

    imageInput.addEventListener('change', () => {
        const file = imageInput.files[0];
        if (!file) {
            imagePreview.innerHTML = '<p>画像を選択するとここにプレビューが表示されます。</p>';
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            imagePreview.innerHTML = ''; // 既存のテキストをクリア
            const img = document.createElement('img');
            img.src = e.target.result;
            imagePreview.appendChild(img);
        };
        reader.readAsDataURL(file);
    });

    uploadButton.addEventListener('click', async () => {
        const file = imageInput.files[0];
        if (!file) {
            alert('画像ファイルを選択してください。');
            return;
        }

        const formData = new FormData();
        formData.append('receiptImage', file);

        ocrResult.innerHTML = '<p>解析中です...</p>';

        try {
            const response = await fetch('http://localhost:3000/api/upload', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`サーバーエラー: ${response.statusText}`);
            }

            const result = await response.json();
            
            // 結果を整形して表示
            ocrResult.innerText = result.ocrText;

        } catch (error) {
            console.error('アップロードまたは解析中にエラーが発生しました:', error);
            ocrResult.innerHTML = `<p>エラーが発生しました: ${error.message}</p>`;
        }
    });
});

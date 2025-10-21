document.addEventListener('DOMContentLoaded', () => {
    const uploadForm = document.getElementById('upload-form');
    const imageInput = document.getElementById('receipt-image');
    const uploadedImage = document.getElementById('uploaded-image');
    const statusDiv = document.getElementById('status');
    
    const editForm = document.getElementById('edit-form');
    const imagePathInput = document.getElementById('image-path');
    const ocrTextArea = document.getElementById('ocr-text-area');
    const storeNameInput = document.getElementById('store-name');
    const purchaseDateInput = document.getElementById('purchase-date');
    const totalAmountInput = document.getElementById('total-amount');
    const saveButton = document.getElementById('save-button');

    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const file = imageInput.files[0];
        if (!file) {
            alert('画像ファイルを選択してください。');
            return;
        }

        const formData = new FormData();
        formData.append('receipt', file);

        statusDiv.textContent = '解析中です...';
        editForm.style.display = 'none';
        uploadedImage.style.display = 'none';

        try {
            const response = await fetch('http://localhost:3000/upload', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`サーバーエラー: ${response.statusText}`);
            }

            const result = await response.json();
            
            statusDiv.textContent = '解析が完了しました。内容を確認・修正してください。';
            
            // 結果をフォームに表示
            uploadedImage.src = `http://localhost:3000${result.filePath}`;
            uploadedImage.style.display = 'block';
            
            imagePathInput.value = result.filePath;
            ocrTextArea.value = result.ocrText;

            editForm.style.display = 'block';

        } catch (error) {
            console.error('アップロードまたは解析中にエラーが発生しました:', error);
            statusDiv.textContent = `エラーが発生しました: ${error.message}`;
        }
    });

    saveButton.addEventListener('click', async () => {
        const data = {
            imagePath: imagePathInput.value,
            correctedText: ocrTextArea.value,
            storeName: storeNameInput.value,
            purchaseDate: purchaseDateInput.value,
            totalAmount: totalAmountInput.value ? parseInt(totalAmountInput.value, 10) : null,
        };

        statusDiv.textContent = '保存中です...';

        try {
            const response = await fetch('http://localhost:3000/api/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                throw new Error(`サーバーエラー: ${response.statusText}`);
            }

            const result = await response.json();
            statusDiv.textContent = result.message;
            alert('保存しました！');

        } catch (error) {
            console.error('データの保存中にエラーが発生しました:', error);
            statusDiv.textContent = `保存エラー: ${error.message}`;
        }
    });
});


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
    // 現在編集中のエントリID保持用
    let currentEntryId = null;

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
            
            // 結果をフォームに表示 + 抽出データを自動入力
            uploadedImage.src = `http://localhost:3000${result.filePath}`;
            uploadedImage.style.display = 'block';

            editForm.style.display = 'block';

            currentEntryId = result.id || null;
            imagePathInput.value = result.filePath;
            ocrTextArea.value = result.ocrText;

            if (result.extractedData) {
                storeNameInput.value = result.extractedData.storeName || '';
                purchaseDateInput.value = result.extractedData.purchaseDate || '';
                totalAmountInput.value = (result.extractedData.totalAmount != null ? result.extractedData.totalAmount : '');
            }

            // --- itemLinesをテーブル表示 ---
            const itemLinesSection = document.getElementById('item-lines-section');
            const itemLinesTbody = document.getElementById('item-lines-tbody');
            if (Array.isArray(result.itemLines) && result.itemLines.length > 0) {
                itemLinesSection.style.display = 'block';
                itemLinesTbody.innerHTML = '';
                result.itemLines.forEach(line => {
                    const tr = document.createElement('tr');
                    const tdText = document.createElement('td');
                    const tdPrice = document.createElement('td');
                    tdText.textContent = line.text;
                    tdPrice.textContent = line.price || '';
                    tr.appendChild(tdText);
                    tr.appendChild(tdPrice);
                    itemLinesTbody.appendChild(tr);
                });
            } else {
                itemLinesSection.style.display = 'none';
            }

        } catch (error) {
            console.error('アップロードまたは解析中にエラーが発生しました:', error);
            statusDiv.textContent = `エラーが発生しました: ${error.message}`;
        }
    });

    saveButton.addEventListener('click', async () => {
        const data = {
            id: currentEntryId,
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

    // Function to fetch and display entries
    const fetchEntries = async () => {
        try {
            const response = await fetch('http://localhost:3000/api/entries');
            if (!response.ok) {
                throw new Error(`サーバーエラー: ${response.statusText}`);
            }
            const entries = await response.json();
            const tbody = document.getElementById('entries-tbody');
            tbody.innerHTML = ''; // Clear existing rows

            entries.forEach(entry => {
                const row = tbody.insertRow();
                const dateCell = row.insertCell();
                const storeCell = row.insertCell();
                const amountCell = row.insertCell();

                dateCell.textContent = entry.purchase_date;
                storeCell.textContent = entry.store_name;
                amountCell.textContent = entry.total_amount;
            });

        } catch (error) {
            console.error('データの取得中にエラーが発生しました:', error);
        }
    };

    // Fetch entries on page load
    fetchEntries();
});


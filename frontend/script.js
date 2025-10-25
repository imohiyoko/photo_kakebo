document.addEventListener('DOMContentLoaded', () => {
    const uploadForm = document.getElementById('upload-form');
    const imageInput = document.getElementById('receipt-image');
    const uploadedImage = document.getElementById('uploaded-image');
    const statusDiv = document.getElementById('status');
    const modelVersionSpan = document.getElementById('model-version');
    const llmOptinChk = document.getElementById('llm-optin-chk');
    const localTrainChk = document.getElementById('local-train-chk');
    
    const editForm = document.getElementById('edit-form');
    const imagePathInput = document.getElementById('image-path');
    const ocrTextArea = document.getElementById('ocr-text-area');
    const storeNameInput = document.getElementById('store-name');
    const purchaseDateInput = document.getElementById('purchase-date');
    const totalAmountInput = document.getElementById('total-amount');
    const saveButton = document.getElementById('save-button');
    const confirmButton = document.getElementById('confirm-button');
    const uploadMultiBtn = document.getElementById('upload-multi-btn');
    const conflictsBox = document.getElementById('conflicts-box');
    const conflictsList = document.getElementById('conflicts-list');
    const ocrEngineCheckboxes = document.querySelectorAll('.ocr-engine-chk');
    const useLlmCheckbox = document.getElementById('use-llm-chk');
    function getSelectedEngines() {
        return Array.from(ocrEngineCheckboxes)
            .filter(chk => chk.checked)
            .map(chk => chk.value);
    }
    // 現在編集中のエントリID保持用
    let currentEntryId = null;

    // --- モデルバージョン取得 & オプトイン送信 ---
    async function fetchModelVersion() {
        if (!modelVersionSpan) return;
        try {
            const resp = await fetch('http://localhost:3000/api/llm/model/latest');
            if (!resp.ok) throw new Error('version fetch failed');
            const j = await resp.json();
            modelVersionSpan.textContent = j.version ? j.version : 'N/A';
        } catch (e) {
            modelVersionSpan.textContent = '取得失敗';
        }
    }

    function ensureAnonUserId() {
        let uid = localStorage.getItem('anonUserId');
        if (!uid) {
            uid = 'u_' + Math.random().toString(36).slice(2);
            localStorage.setItem('anonUserId', uid);
        }
        return uid;
    }

    async function sendOptInState() {
        if (!llmOptinChk) return;
        const uid = ensureAnonUserId();
        // /api/user/flags へ統合送信（provide_training_data, local_training_enabled）
        const body = {
            user_id: uid,
            provide_training_data: llmOptinChk.checked ? 1 : 0,
            local_training_enabled: localTrainChk && localTrainChk.checked ? 1 : 0
        };
        try {
            await fetch('http://localhost:3000/api/user/flags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } catch (e) {
            console.warn('flags送信失敗', e.message);
        }
    }

    if (llmOptinChk) {
        llmOptinChk.addEventListener('change', sendOptInState);
    }
    if (localTrainChk) {
        localTrainChk.addEventListener('change', sendOptInState);
    }
    // 初期フラグ読み込み
    (async () => {
        const uid = ensureAnonUserId();
        try {
            const r = await fetch(`http://localhost:3000/api/user/flags/${uid}`);
            if (r.ok) {
                const f = await r.json();
                if (llmOptinChk) llmOptinChk.checked = !!f.provide_training_data;
                if (localTrainChk) localTrainChk.checked = !!f.local_training_enabled;
            }
        } catch {}
    })();
    fetchModelVersion();

    // --- 単体OCRアップロード（既存機能） ---
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const file = imageInput.files[0];
        if (!file) { alert('画像ファイルを選択してください。'); return; }
        const formData = new FormData();
        formData.append('receipt', file);
        statusDiv.textContent = '解析中です...';
        editForm.style.display = 'none';
        uploadedImage.style.display = 'none';
        conflictsBox.style.display = 'none';
        conflictsList.innerHTML = '';
        try {
            const response = await fetch('http://localhost:3000/upload', { method: 'POST', body: formData });
            if (!response.ok) throw new Error(`サーバーエラー: ${response.statusText}`);
            const result = await response.json();
            statusDiv.textContent = '解析が完了しました。内容を確認・修正してください。';
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

    // --- マルチOCRアップロード（選択エンジン＋LLM） ---
    uploadMultiBtn.addEventListener('click', async () => {
        const file = imageInput.files[0];
        if (!file) { alert('画像ファイルを選択してください。'); return; }
        const engines = getSelectedEngines();
        if (engines.length === 0) { alert('少なくとも1つOCRエンジンを選択してください'); return; }
        const formData = new FormData();
        formData.append('receipt', file);
        formData.append('engines', JSON.stringify(engines));
        formData.append('use_llm', useLlmCheckbox.checked ? '1' : '0');
        statusDiv.textContent = 'マルチOCR解析中...';
        editForm.style.display = 'none';
        uploadedImage.style.display = 'none';
        conflictsBox.style.display = 'none';
        conflictsList.innerHTML = '';
        try {
            const resp = await fetch('http://localhost:3000/upload_multi', { method: 'POST', body: formData });
            if (!resp.ok) throw new Error('サーバーエラー');
            const result = await resp.json();
            statusDiv.textContent = 'マルチOCR完了。内容確認してください。';
            uploadedImage.src = `http://localhost:3000${result.filePath}`;
            uploadedImage.style.display = 'block';
            editForm.style.display = 'block';
            currentEntryId = result.id || null;
            imagePathInput.value = result.filePath;
            ocrTextArea.value = result.aggregatedText || '';
            if (result.extractedData) {
                storeNameInput.value = result.extractedData.storeName || '';
                purchaseDateInput.value = result.extractedData.purchaseDate || '';
                totalAmountInput.value = (result.extractedData.totalAmount != null ? result.extractedData.totalAmount : '');
            }
            if (Array.isArray(result.conflicts) && result.conflicts.length > 0) {
                conflictsBox.style.display = 'block';
                conflictsList.innerHTML = '';
                result.conflicts.forEach(c => {
                    const li = document.createElement('li');
                    li.textContent = `行${c.lineIndex}: ${c.candidates.join(' | ')}`;
                    conflictsList.appendChild(li);
                });
            }
            if (Array.isArray(result.llmResolutions) && result.llmResolutions.length > 0) {
                console.log('LLM補完結果:', result.llmResolutions);
            }
        } catch (err) {
            console.error(err);
            statusDiv.textContent = 'マルチOCR失敗: ' + err.message;
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

    // --- 確定処理（差分ログ送信） ---
    // 既存 ensureAnonUserId 定義は上で再定義済みにつき削除

    async function confirmEdits() {
        if (!currentEntryId) {
            alert('エントリがありません。先にアップロードしてください。');
            return;
        }
        const edited = {
            store_name: storeNameInput.value || null,
            purchase_date: purchaseDateInput.value || null,
            total_amount: totalAmountInput.value ? parseInt(totalAmountInput.value,10) : null,
            corrected_text: ocrTextArea.value || null
        };
        const userId = ensureAnonUserId();
        statusDiv.textContent = '確定処理中...';
        try {
            const resp = await fetch(`http://localhost:3000/api/entries/${currentEntryId}/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ edited, userId })
            });
            if (!resp.ok) throw new Error('サーバーエラー');
            const result = await resp.json();
            statusDiv.textContent = `確定しました（差分: ${result.diff_count}件）`;
            alert('確定して学習ログへ登録しました');
            // 学習データ提供 & ローカル学習でない場合は中央送信
            if (llmOptinChk && llmOptinChk.checked && !(localTrainChk && localTrainChk.checked)) {
                try {
                    const payload = {
                        user_id: userId,
                        entry_id: currentEntryId,
                        corrected_text: ocrTextArea.value || '',
                        store_name: storeNameInput.value || null,
                        purchase_date: purchaseDateInput.value || null,
                        total_amount: totalAmountInput.value ? parseInt(totalAmountInput.value,10) : null,
                        image_path: imagePathInput.value || null,
                        image_hash: null
                    };
                    await fetch('http://localhost:3000/api/training/upload', {
                        method:'POST',
                        headers:{'Content-Type':'application/json'},
                        body: JSON.stringify(payload)
                    });
                } catch(e) {
                    console.warn('学習データ中央送信失敗', e.message);
                }
            }
        } catch (e) {
            console.error(e);
            statusDiv.textContent = '確定処理に失敗しました';
        }
    }
    confirmButton.addEventListener('click', confirmEdits);

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


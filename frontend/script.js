document.addEventListener('DOMContentLoaded', () => {
    const imageInput = document.getElementById('receiptImage');
    const imagePreview = document.getElementById('imagePreview');

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

    // TODO: 「解析する」ボタンが押されたときの処理を実装する
});

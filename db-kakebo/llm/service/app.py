from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
import re
import time

app = FastAPI(title="Receipt LLM Service", version="0.1.0")

class ConflictItem(BaseModel):
    lineIndex: int
    candidates: List[str]
    contextBefore: List[str] = []
    contextAfter: List[str] = []

class ConflictRequest(BaseModel):
    conflicts: List[ConflictItem]
    task: Optional[str] = "conflict"
    model_version: Optional[str] = "stub_v0"

@app.get("/health")
async def health():
    return {"status": "ok"}

KANJI_RE = re.compile(r"[一-龥々〆ヵヶぁ-んァ-ヶー]")
NUM_RE = re.compile(r"\d+")

def score_candidate(cand: str) -> float:
    # ヒューリスティック: 漢字/カナ割合 + 価格行っぽい整合性 + 長さバランス
    if not cand:
        return 0.0
    length = len(cand)
    kanji_kana = len(KANJI_RE.findall(cand))
    nums = len(NUM_RE.findall(cand))
    # 数値のみはノイズ扱いで減点
    if kanji_kana == 0 and nums > 0 and nums * 4 >= length:
        base = 0.2
    else:
        base = 0.5 + (kanji_kana / (length + 0.01))
    # 過度に長すぎる行は減点
    if length > 60:
        base *= 0.7
    return base

@app.post("/resolve_conflicts")
async def resolve_conflicts(req: ConflictRequest):
    start = time.time()
    resolutions = []
    for c in req.conflicts:
        scored = sorted(c.candidates, key=lambda x: score_candidate(x), reverse=True)
        chosen = scored[0] if scored else ""
        resolutions.append({
            "lineIndex": c.lineIndex,
            "resolved": chosen,
            "candidates": c.candidates,
            "contextBefore": c.contextBefore,
            "contextAfter": c.contextAfter
        })
    return {
        "resolutions": resolutions,
        "latency_ms": int((time.time() - start) * 1000),
        "model_version": req.model_version
    }

# 起動例: uvicorn app:app --host 0.0.0.0 --port 8001

#!/usr/bin/env bash
# WSL用統合起動スクリプト
# 前提: NodeとPython環境がローカルに存在

set -e

# APIサーバ
( cd ../db-kakebo && node server.js ) &
API_PID=$!

echo "API server started PID=$API_PID"

# LLMスタブ (FastAPI) が存在する場合
if [ -d "../llm/service" ]; then
  ( cd ../llm/service && python -m uvicorn app:app --port 8000 --reload ) &
  LLM_PID=$!
  echo "LLM service started PID=$LLM_PID"
fi

echo "Open http://localhost:3000/ for user-web and http://localhost:3000/admin for admin"

echo "Press Ctrl+C to stop."
wait

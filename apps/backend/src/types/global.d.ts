// グローバル環境変数型 (最小)
declare namespace NodeJS {
  interface ProcessEnv {
    PORT?: string;
    PREPROCESS_API_URL?: string;
    PADDLE_OCR_API_URL?: string;
    TROCR_API_URL?: string;
    LLM_API_URL?: string;
    LLM_MODEL?: string;
    LLM_MODEL_VERSION?: string;
    LLM_BACKEND?: 'stub' | 'ollama' | 'transformers';
  }
}
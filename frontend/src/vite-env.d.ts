/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端 API 基地址，例如 https://api.example.com；留空表示与页面同源。 */
  readonly VITE_API_BASE?: string;
  /** WebSocket 基地址，例如 wss://api.example.com；留空表示与页面同源。 */
  readonly VITE_WS_BASE?: string;
  /** 本地开发时 vite 代理指向的后端地址。 */
  readonly VITE_DEV_BACKEND?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

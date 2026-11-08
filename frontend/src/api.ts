export interface AuthStatus {
  authorized: boolean;
  locked: boolean;
  error?: string;
  remainingDailyAttempts?: number;
  remainingIpAttempts?: number;
}


/**
 * 后端基地址。默认留空 = 与页面同源（推荐部署方式：同一个反向代理同时托管
 * 静态资源并转发 /api、/ws）。只有当 API 被挂在同站点的其他路径下时才需要
 * 设置 VITE_API_BASE；跨站部署还需要后端开启 CORS 与 SameSite=None Cookie。
 */
const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");
const CREDENTIALS: RequestCredentials = API_BASE ? "include" : "same-origin";


function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}


function getCookie(name: string): string {
  const prefix = `${name}=`;
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
}


async function readJson(response: Response): Promise<AuthStatus> {
  const payload = (await response.json().catch(() => ({}))) as AuthStatus;
  if (!response.ok && response.status !== 401 && response.status !== 423) {
    throw new Error(payload.error || `请求失败（${response.status}）`);
  }
  return payload;
}


export async function fetchAuthStatus(): Promise<AuthStatus> {
  const response = await fetch(apiUrl("/api/auth/status"), {
    credentials: CREDENTIALS,
    cache: "no-store",
  });
  return readJson(response);
}


export async function login(password: string): Promise<AuthStatus> {
  const response = await fetch(apiUrl("/api/auth/login"), {
    method: "POST",
    credentials: CREDENTIALS,
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCookie("cloudrop_csrf"),
    },
    body: JSON.stringify({ password }),
  });
  return readJson(response);
}


export async function logout(): Promise<void> {
  await fetch(apiUrl("/api/auth/logout"), {
    method: "POST",
    credentials: CREDENTIALS,
    headers: {
      "X-CSRFToken": getCookie("cloudrop_csrf"),
    },
  });
}


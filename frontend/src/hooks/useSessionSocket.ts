import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ChatKind,
  ChatMessage,
  ConnectionState,
  PairInfo,
  SignalKind,
} from "../types";


const PAIR_ALPHABET = new Set("ABCDEFGHJKMNPQRSTUVWXYZ23456789_@$&".split(""));
const PAIR_ERROR_CODES = new Set([
  "invalid_key",
  "key_unavailable",
  "self_pair",
  "already_paired",
]);

interface SessionCallbacks {
  onLocked: () => void;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
  onSignal: (kind: SignalKind, payload: Record<string, unknown>) => void;
}

interface ReadyMessage {
  type: "ready";
  peerId: string;
  key: string;
  iceServers: RTCIceServer[];
  maxFileSize: number;
}

type ServerMessage =
  | ReadyMessage
  | { type: "paired"; initiator: boolean }
  | { type: "peer_disconnected"; key: string }
  | { type: "chat"; id: string; kind: ChatKind; content: string }
  | { type: "signal"; kind: SignalKind; payload: Record<string, unknown> }
  | { type: "error"; code: string; message: string }
  | { type: "server_locked" }
  | { type: "pong" };


/** 默认同源；只有需要指向同站其他路径时才配置 VITE_WS_BASE。 */
const WS_BASE = (import.meta.env.VITE_WS_BASE ?? "").replace(/\/+$/, "");


function websocketUrl(): string {
  if (WS_BASE) return `${WS_BASE}/ws/session/`;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/session/`;
}


function classifyContent(content: string): ChatKind {
  try {
    const url = new URL(content);
    return url.protocol === "http:" || url.protocol === "https:" ? "link" : "text";
  } catch {
    return "text";
  }
}


export function useSessionSocket(callbacks: SessionCallbacks) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const socketRef = useRef<WebSocket | null>(null);
  const manualCloseRef = useRef(false);
  const pairVersionRef = useRef(0);
  const requestedKeyRef = useRef(new URLSearchParams(window.location.search).get("pair"));
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [pairKey, setPairKey] = useState("");
  const [pairInfo, setPairInfo] = useState<PairInfo | null>(null);
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([]);
  const [maxFileSize, setMaxFileSize] = useState(1024 * 1024 * 1024);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState("");
  const [disconnectNotice, setDisconnectNotice] = useState(false);

  const sendRaw = useCallback((payload: object): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      callbacksRef.current.onError("实时连接尚未就绪");
      return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  useEffect(() => {
    manualCloseRef.current = false;
    let disposed = false;
    let retryTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let retryCount = 0;
    const connect = () => {
      if (disposed) return;
      setConnection("connecting");
      const socket = new WebSocket(websocketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        retryCount = 0;
        heartbeatTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
          }
        }, 25_000);
      };

      socket.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          callbacksRef.current.onError("收到无法解析的服务器消息");
          return;
        }

        switch (message.type) {
          case "ready":
            setPairKey(message.key);
            setIceServers(message.iceServers || []);
            setMaxFileSize(message.maxFileSize);
            setPairInfo(null);
            setConnection("waiting");
            setPairing(false);
            setPairError("");
            setDisconnectNotice(false);
            if (requestedKeyRef.current) {
              setPairing(true);
              socket.send(JSON.stringify({ type: "pair", key: requestedKeyRef.current }));
              requestedKeyRef.current = null;
              window.history.replaceState({}, "", window.location.pathname);
            }
            break;
          case "paired":
            pairVersionRef.current += 1;
            setPairInfo({ version: pairVersionRef.current, initiator: message.initiator });
            setPairKey("");
            setConnection("paired");
            setPairing(false);
            setPairError("");
            setDisconnectNotice(false);
            setMessages([]);
            callbacksRef.current.onInfo("配对成功，可以开始实时传输");
            break;
          case "peer_disconnected":
            setPairInfo(null);
            setPairKey(message.key);
            setConnection("waiting");
            setPairing(false);
            setPairError("");
            setDisconnectNotice(true);
            callbacksRef.current.onInfo("对端已断开，已生成新的配对 Key");
            break;
          case "chat":
            setMessages((current) => [
              ...current,
              {
                id: message.id,
                kind: message.kind,
                content: message.content,
                direction: "received",
                createdAt: Date.now(),
              },
            ]);
            break;
          case "signal":
            callbacksRef.current.onSignal(message.kind, message.payload);
            break;
          case "error":
            if (PAIR_ERROR_CODES.has(message.code)) {
              setPairing(false);
              setPairError(message.message);
            } else {
              callbacksRef.current.onError(message.message);
            }
            break;
          case "server_locked":
            manualCloseRef.current = true;
            callbacksRef.current.onLocked();
            break;
          case "pong":
            break;
        }
      };

      socket.onclose = (event) => {
        if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
        if (disposed || manualCloseRef.current) return;
        if (event.code === 4423) {
          callbacksRef.current.onLocked();
          return;
        }
        if (event.code === 4401) {
          callbacksRef.current.onUnauthorized();
          return;
        }
        setPairInfo(null);
        setPairKey("");
        setPairing(false);
        setConnection("disconnected");
        const delay = Math.min(5000, 500 * 2 ** retryCount);
        retryCount += 1;
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      manualCloseRef.current = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
      socketRef.current?.close(1000, "page closed");
      socketRef.current = null;
    };
  }, []);

  const pair = useCallback(
    (rawKey: string) => {
      const key = rawKey.trim().toUpperCase();
      if (key.length !== 8 || [...key].some((character) => !PAIR_ALPHABET.has(character))) {
        setPairError("请输入有效的 8 位配对 Key");
        return false;
      }
      if (connection !== "waiting" || pairing) {
        return false;
      }
      setPairError("");
      setPairing(true);
      if (sendRaw({ type: "pair", key })) return true;
      setPairing(false);
      return false;
    },
    [connection, pairing, sendRaw],
  );

  const clearPairError = useCallback(() => setPairError(""), []);
  const dismissDisconnectNotice = useCallback(() => setDisconnectNotice(false), []);

  const sendChat = useCallback(
    (rawContent: string) => {
      const content = rawContent.trim();
      if (!content) return false;
      if (connection !== "paired") {
        callbacksRef.current.onError("请先完成配对");
        return false;
      }
      const kind = classifyContent(content);
      const id = crypto.randomUUID();
      if (!sendRaw({ type: "chat", id, kind, content })) return false;
      setMessages((current) => [
        ...current,
        { id, kind, content, direction: "sent", createdAt: Date.now() },
      ]);
      return true;
    },
    [connection, sendRaw],
  );

  const sendSignal = useCallback(
    (kind: SignalKind, payload: Record<string, unknown>) =>
      sendRaw({ type: "signal", kind, payload }),
    [sendRaw],
  );

  const leave = useCallback(() => sendRaw({ type: "leave" }), [sendRaw]);

  return {
    connection,
    pairKey,
    pairInfo,
    iceServers,
    maxFileSize,
    messages,
    pairing,
    pairError,
    disconnectNotice,
    pair,
    clearPairError,
    dismissDisconnectNotice,
    sendChat,
    sendSignal,
    leave,
  };
}

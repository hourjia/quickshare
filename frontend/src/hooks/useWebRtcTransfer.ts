import { useCallback, useEffect, useRef, useState } from "react";

import type {
  FileMetadata,
  PairInfo,
  SignalKind,
  TransferItem,
} from "../types";


const CHUNK_SIZE = 16 * 1024;
const BUFFER_HIGH_WATER = 1024 * 1024;

type RtcState = "idle" | "connecting" | "ready" | "failed";

interface WritableSink {
  write(data: ArrayBuffer): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

interface TempFileHandle {
  createWritable(): Promise<WritableSink>;
  getFile(): Promise<File>;
}

interface TempDirectoryHandle {
  getFileHandle(name: string, options: { create: boolean }): Promise<TempFileHandle>;
  removeEntry(name: string): Promise<void>;
  entries(): AsyncIterableIterator<[string, unknown]>;
}

interface IncomingRuntime {
  meta: FileMetadata;
  writer: WritableSink;
  received: number;
  startedAt: number;
  lastUiUpdate: number;
  tempHandle?: TempFileHandle;
  tempDirectory?: TempDirectoryHandle;
  tempName?: string;
}

interface OutgoingRuntime {
  file: File;
  cancelled: boolean;
  startedAt: number;
  lastUiUpdate: number;
}

interface CompletedTempFile {
  directory: TempDirectoryHandle;
  name: string;
  url: string;
  cleanupScheduled: boolean;
}

interface WebRtcOptions {
  pairInfo: PairInfo | null;
  iceServers: RTCIceServer[];
  maxFileSize: number;
  sendSignal: (kind: SignalKind, payload: Record<string, unknown>) => boolean;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
}


function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}


function activeStatus(status: TransferItem["status"]): boolean {
  return ["offered", "waiting", "sending", "receiving"].includes(status);
}


export function useWebRtcTransfer({
  pairInfo,
  iceServers,
  maxFileSize,
  sendSignal,
  onError,
  onInfo,
}: WebRtcOptions) {
  const [rtcState, setRtcState] = useState<RtcState>("idle");
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const pendingSignalsRef = useRef<Array<{ kind: SignalKind; payload: Record<string, unknown> }>>([]);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const incomingRef = useRef(new Map<string, IncomingRuntime>());
  const incomingOffersRef = useRef(new Map<string, FileMetadata>());
  const outgoingRef = useRef(new Map<string, OutgoingRuntime>());
  const completedTempRef = useRef(new Map<string, CompletedTempFile>());
  const expectedBinaryRef = useRef<{ id: string; length: number } | null>(null);
  const receiveQueueRef = useRef(Promise.resolve());
  const handleDataRef = useRef<(data: string | ArrayBuffer | Blob) => Promise<void>>(async () => undefined);

  useEffect(() => {
    const storage = navigator.storage as unknown as {
      getDirectory?: () => Promise<TempDirectoryHandle>;
    };
    if (!storage.getDirectory) return;
    void (async () => {
      const directory = await storage.getDirectory!();
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for await (const [name] of directory.entries()) {
        if (!name.startsWith("cloudrop-")) continue;
        const timestamp = Number(name.split("-", 3)[1]);
        if (Number.isFinite(timestamp) && timestamp < cutoff) {
          await directory.removeEntry(name).catch(() => undefined);
        }
      }
    })().catch(() => undefined);
  }, []);

  useEffect(
    () => () => {
      for (const runtime of incomingRef.current.values()) {
        void runtime.writer.abort?.("page closed");
        if (runtime.tempDirectory && runtime.tempName) {
          void runtime.tempDirectory.removeEntry(runtime.tempName).catch(() => undefined);
        }
      }
      for (const completed of completedTempRef.current.values()) {
        URL.revokeObjectURL(completed.url);
        void completed.directory.removeEntry(completed.name).catch(() => undefined);
      }
    },
    [],
  );

  const updateTransfer = useCallback((id: string, patch: Partial<TransferItem>) => {
    setTransfers((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const sendControl = useCallback((payload: object): boolean => {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open") return false;
    channel.send(JSON.stringify(payload));
    return true;
  }, []);

  const configureDataChannel = useCallback((channel: RTCDataChannel) => {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 256 * 1024;
    channel.onopen = () => setRtcState("ready");
    channel.onclose = () => setRtcState("failed");
    channel.onerror = () => setRtcState("failed");
    channel.onmessage = (event) => {
      receiveQueueRef.current = receiveQueueRef.current
        .then(() => handleDataRef.current(event.data as string | ArrayBuffer | Blob))
        .catch((error) => onError(`文件数据处理失败：${formatError(error)}`));
    };
    channelRef.current = channel;
    if (channel.readyState === "open") setRtcState("ready");
  }, [onError]);

  const applySignal = useCallback(
    async (kind: SignalKind, payload: Record<string, unknown>) => {
      const peer = peerRef.current;
      if (!peer) {
        pendingSignalsRef.current.push({ kind, payload });
        return;
      }
      if (kind === "offer") {
        await peer.setRemoteDescription(payload as unknown as RTCSessionDescriptionInit);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        sendSignal(
          "answer",
          peer.localDescription!.toJSON() as unknown as Record<string, unknown>,
        );
        for (const candidate of pendingIceRef.current.splice(0)) {
          await peer.addIceCandidate(candidate);
        }
      } else if (kind === "answer") {
        await peer.setRemoteDescription(payload as unknown as RTCSessionDescriptionInit);
        for (const candidate of pendingIceRef.current.splice(0)) {
          await peer.addIceCandidate(candidate);
        }
      } else {
        const candidate = payload as RTCIceCandidateInit;
        if (peer.remoteDescription) {
          await peer.addIceCandidate(candidate);
        } else {
          pendingIceRef.current.push(candidate);
        }
      }
    },
    [sendSignal],
  );

  const handleSignal = useCallback(
    (kind: SignalKind, payload: Record<string, unknown>) => {
      void applySignal(kind, payload).catch((error) => {
        setRtcState("failed");
        onError(`WebRTC 协商失败：${formatError(error)}`);
      });
    },
    [applySignal, onError],
  );

  useEffect(() => {
    if (!pairInfo) {
      peerRef.current?.close();
      peerRef.current = null;
      channelRef.current?.close();
      channelRef.current = null;
      pendingSignalsRef.current = [];
      pendingIceRef.current = [];
      expectedBinaryRef.current = null;
      for (const runtime of incomingRef.current.values()) {
        void runtime.writer.abort?.("peer disconnected");
        if (runtime.tempDirectory && runtime.tempName) {
          void runtime.tempDirectory.removeEntry(runtime.tempName).catch(() => undefined);
        }
      }
      incomingRef.current.clear();
      incomingOffersRef.current.clear();
      for (const runtime of outgoingRef.current.values()) runtime.cancelled = true;
      outgoingRef.current.clear();
      setTransfers((current) =>
        current.map((item) =>
          activeStatus(item.status)
            ? { ...item, status: "failed", error: "对端已断开" }
            : item,
        ),
      );
      setRtcState("idle");
      return;
    }

    let disposed = false;
    const peer = new RTCPeerConnection({ iceServers });
    peerRef.current = peer;
    setRtcState("connecting");

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal("ice", event.candidate.toJSON() as Record<string, unknown>);
      }
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") setRtcState("ready");
      if (["failed", "closed"].includes(peer.connectionState)) setRtcState("failed");
    };
    peer.ondatachannel = (event) => configureDataChannel(event.channel);

    const start = async () => {
      if (pairInfo.initiator) {
        configureDataChannel(peer.createDataChannel("cloudrop-files", { ordered: true }));
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        sendSignal(
          "offer",
          peer.localDescription!.toJSON() as unknown as Record<string, unknown>,
        );
      }
      for (const signal of pendingSignalsRef.current.splice(0)) {
        await applySignal(signal.kind, signal.payload);
      }
    };
    void start().catch((error) => {
      if (!disposed) {
        setRtcState("failed");
        onError(`WebRTC 初始化失败：${formatError(error)}`);
      }
    });

    return () => {
      disposed = true;
      peer.close();
      if (peerRef.current === peer) peerRef.current = null;
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [applySignal, configureDataChannel, iceServers, onError, pairInfo, sendSignal]);

  const waitForBuffer = async (channel: RTCDataChannel, runtime: OutgoingRuntime) => {
    while (channel.bufferedAmount > BUFFER_HIGH_WATER) {
      if (runtime.cancelled) throw new Error("传输已取消");
      if (channel.readyState !== "open") throw new Error("文件通道已断开");
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
  };

  const streamOutgoing = useCallback(
    async (id: string) => {
      const runtime = outgoingRef.current.get(id);
      const channel = channelRef.current;
      if (!runtime || !channel || channel.readyState !== "open") return;
      runtime.startedAt = performance.now();
      runtime.lastUiUpdate = runtime.startedAt;
      updateTransfer(id, { status: "sending", progress: 0, speed: 0 });
      sendControl({ type: "file-start", id });
      let offset = 0;
      try {
        while (offset < runtime.file.size) {
          if (runtime.cancelled) throw new Error("传输已取消");
          await waitForBuffer(channel, runtime);
          const end = Math.min(runtime.file.size, offset + CHUNK_SIZE);
          const chunk = await runtime.file.slice(offset, end).arrayBuffer();
          sendControl({ type: "file-chunk", id, length: chunk.byteLength });
          channel.send(chunk);
          offset = end;
          const now = performance.now();
          if (now - runtime.lastUiUpdate >= 200 || offset === runtime.file.size) {
            const seconds = Math.max(0.001, (now - runtime.startedAt) / 1000);
            updateTransfer(id, {
              progress: Math.round((offset / runtime.file.size) * 100),
              speed: offset / seconds,
            });
            runtime.lastUiUpdate = now;
          }
        }
        sendControl({ type: "file-complete", id });
        updateTransfer(id, { status: "complete", progress: 100 });
        outgoingRef.current.delete(id);
      } catch (error) {
        const cancelled = runtime.cancelled;
        sendControl({ type: "file-cancel", id, reason: formatError(error) });
        updateTransfer(id, {
          status: cancelled ? "cancelled" : "failed",
          error: formatError(error),
        });
        outgoingRef.current.delete(id);
      }
    },
    [sendControl, updateTransfer],
  );

  const finalizeIncoming = useCallback(
    async (id: string) => {
      const runtime = incomingRef.current.get(id);
      if (!runtime) return;
      if (runtime.received !== runtime.meta.size) {
        throw new Error(`文件大小校验失败：收到 ${runtime.received} 字节`);
      }
      await runtime.writer.close();
      let downloadUrl: string | undefined;
      let savedDirectly = true;
      if (runtime.tempHandle) {
        const file = await runtime.tempHandle.getFile();
        downloadUrl = URL.createObjectURL(file);
        savedDirectly = false;
        if (runtime.tempDirectory && runtime.tempName) {
          completedTempRef.current.set(id, {
            directory: runtime.tempDirectory,
            name: runtime.tempName,
            url: downloadUrl,
            cleanupScheduled: false,
          });
        }
      }
      updateTransfer(id, {
        status: "complete",
        progress: 100,
        downloadUrl,
        savedDirectly,
      });
      incomingRef.current.delete(id);
      onInfo(savedDirectly ? "文件接收完成并已保存" : "文件接收完成，请点击保存");
    },
    [onInfo, updateTransfer],
  );

  const handleControl = useCallback(
    async (payload: Record<string, unknown>) => {
      const type = payload.type;
      const id = typeof payload.id === "string" ? payload.id : "";
      if (type === "file-meta") {
        const meta: FileMetadata = {
          id,
          name: typeof payload.name === "string" ? payload.name : "未命名文件",
          size: typeof payload.size === "number" ? payload.size : -1,
          mime: typeof payload.mime === "string" ? payload.mime : "application/octet-stream",
        };
        if (!id || meta.size < 0 || meta.size > maxFileSize) {
          sendControl({ type: "file-reject", id, reason: "文件信息或大小不合法" });
          return;
        }
        incomingOffersRef.current.set(id, meta);
        setTransfers((current) => [
          ...current,
          {
            ...meta,
            direction: "received",
            status: "offered",
            progress: 0,
            speed: 0,
          },
        ]);
        onInfo(`收到文件发送请求：${meta.name}`);
      } else if (type === "file-accept") {
        void streamOutgoing(id);
      } else if (type === "file-reject") {
        outgoingRef.current.delete(id);
        updateTransfer(id, {
          status: "cancelled",
          error: typeof payload.reason === "string" ? payload.reason : "对方已拒绝接收",
        });
      } else if (type === "file-start") {
        const runtime = incomingRef.current.get(id);
        if (runtime) runtime.startedAt = performance.now();
      } else if (type === "file-chunk") {
        const length = typeof payload.length === "number" ? payload.length : -1;
        if (!incomingRef.current.has(id) || length < 0 || length > CHUNK_SIZE) {
          throw new Error("文件分块协议不正确");
        }
        expectedBinaryRef.current = { id, length };
      } else if (type === "file-complete") {
        await finalizeIncoming(id);
      } else if (type === "file-cancel") {
        const incoming = incomingRef.current.get(id);
        if (incoming) {
          await incoming.writer.abort?.("sender cancelled");
          if (incoming.tempDirectory && incoming.tempName) {
            await incoming.tempDirectory.removeEntry(incoming.tempName).catch(() => undefined);
          }
          incomingRef.current.delete(id);
        }
        const outgoing = outgoingRef.current.get(id);
        if (outgoing) {
          outgoing.cancelled = true;
          outgoingRef.current.delete(id);
        }
        updateTransfer(id, {
          status: "cancelled",
          error: typeof payload.reason === "string" ? payload.reason : "对端取消了传输",
        });
      }
    },
    [finalizeIncoming, maxFileSize, onInfo, sendControl, streamOutgoing, updateTransfer],
  );

  const handleData = useCallback(
    async (data: string | ArrayBuffer | Blob) => {
      if (typeof data === "string") {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        await handleControl(parsed);
        return;
      }
      const expected = expectedBinaryRef.current;
      if (!expected) throw new Error("收到没有分块头的二进制数据");
      const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
      if (buffer.byteLength !== expected.length) throw new Error("文件分块长度不匹配");
      const runtime = incomingRef.current.get(expected.id);
      if (!runtime) throw new Error("找不到对应的接收任务");
      await runtime.writer.write(buffer);
      runtime.received += buffer.byteLength;
      expectedBinaryRef.current = null;
      const now = performance.now();
      if (now - runtime.lastUiUpdate >= 200 || runtime.received === runtime.meta.size) {
        const seconds = Math.max(0.001, (now - runtime.startedAt) / 1000);
        updateTransfer(expected.id, {
          progress: Math.round((runtime.received / runtime.meta.size) * 100),
          speed: runtime.received / seconds,
        });
        runtime.lastUiUpdate = now;
      }
    },
    [handleControl, updateTransfer],
  );
  handleDataRef.current = handleData;

  const offerFile = useCallback(
    (file: File) => {
      if (rtcState !== "ready" || channelRef.current?.readyState !== "open") {
        onError("文件直连通道尚未就绪");
        return false;
      }
      if (file.size > maxFileSize) {
        onError("单个文件不能超过 1 GB");
        return false;
      }
      if ([...outgoingRef.current.values()].some((runtime) => !runtime.cancelled)) {
        onError("当前已有文件正在等待或发送，请完成后再选择新文件");
        return false;
      }
      const id = crypto.randomUUID();
      outgoingRef.current.set(id, {
        file,
        cancelled: false,
        startedAt: 0,
        lastUiUpdate: 0,
      });
      setTransfers((current) => [
        ...current,
        {
          id,
          name: file.name,
          size: file.size,
          mime: file.type || "application/octet-stream",
          direction: "sent",
          status: "waiting",
          progress: 0,
          speed: 0,
        },
      ]);
      return sendControl({
        type: "file-meta",
        id,
        name: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream",
      });
    },
    [maxFileSize, onError, rtcState, sendControl],
  );

  const prepareSink = async (meta: FileMetadata) => {
    const storage = navigator.storage as unknown as {
      getDirectory?: () => Promise<TempDirectoryHandle>;
    };
    if (storage.getDirectory) {
      const directory = await storage.getDirectory();
    const tempName = `cloudrop-${Date.now()}-${meta.id}`;
      const handle = await directory.getFileHandle(tempName, { create: true });
      return {
        writer: await handle.createWritable(),
        tempHandle: handle,
        tempDirectory: directory,
        tempName,
      };
    }

    const picker = (
      window as unknown as {
        showSaveFilePicker?: (options: Record<string, unknown>) => Promise<TempFileHandle>;
      }
    ).showSaveFilePicker;
    if (picker) {
      const handle = await picker({ suggestedName: meta.name });
      return { writer: await handle.createWritable() };
    }
    throw new Error("当前浏览器不支持大文件本地写入");
  };

  const acceptFile = useCallback(
    async (id: string) => {
      const meta = incomingOffersRef.current.get(id);
      if (!meta) return;
      if (incomingRef.current.size > 0) {
        onError("当前已有文件正在接收");
        return;
      }
      try {
        const sink = await prepareSink(meta);
        incomingRef.current.set(id, {
          meta,
          ...sink,
          received: 0,
          startedAt: performance.now(),
          lastUiUpdate: performance.now(),
        });
        incomingOffersRef.current.delete(id);
        updateTransfer(id, { status: "receiving" });
        sendControl({ type: "file-accept", id });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        onError(`无法准备接收文件：${formatError(error)}`);
      }
    },
    [onError, sendControl, updateTransfer],
  );

  const rejectFile = useCallback(
    (id: string) => {
      incomingOffersRef.current.delete(id);
      updateTransfer(id, { status: "cancelled", error: "已拒绝接收" });
      sendControl({ type: "file-reject", id, reason: "对方已拒绝接收" });
    },
    [sendControl, updateTransfer],
  );

  const cancelTransfer = useCallback(
    (id: string) => {
      const outgoing = outgoingRef.current.get(id);
      if (outgoing) {
        outgoing.cancelled = true;
        outgoingRef.current.delete(id);
      }
      const incoming = incomingRef.current.get(id);
      if (incoming) {
        void incoming.writer.abort?.("cancelled");
        if (incoming.tempDirectory && incoming.tempName) {
          void incoming.tempDirectory.removeEntry(incoming.tempName).catch(() => undefined);
        }
        incomingRef.current.delete(id);
      }
      incomingOffersRef.current.delete(id);
      sendControl({ type: "file-cancel", id, reason: "对方取消了传输" });
      updateTransfer(id, { status: "cancelled", error: "传输已取消" });
    },
    [sendControl, updateTransfer],
  );

  const releaseReceived = useCallback(
    (id: string) => {
      const completed = completedTempRef.current.get(id);
      if (!completed || completed.cleanupScheduled) return;
      completed.cleanupScheduled = true;
      window.setTimeout(() => {
        URL.revokeObjectURL(completed.url);
        void completed.directory.removeEntry(completed.name).catch(() => undefined);
        completedTempRef.current.delete(id);
        updateTransfer(id, { downloadUrl: undefined });
      }, 60_000);
    },
    [updateTransfer],
  );

  return {
    rtcState,
    transfers,
    handleSignal,
    offerFile,
    acceptFile,
    rejectFile,
    cancelTransfer,
    releaseReceived,
  };
}

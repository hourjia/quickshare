import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App,
  Badge,
  Button,
  ConfigProvider,
  Empty,
  Input,
  Popconfirm,
  Progress,
  QRCode,
  Segmented,
  Tag,
  Tooltip,
  Typography,
  Upload,
  theme as antdTheme,
} from "antd";
import {
  CheckCircleOutlined,
  CloseOutlined,
  CloudSyncOutlined,
  CopyOutlined,
  DisconnectOutlined,
  DownloadOutlined,
  FileOutlined,
  InboxOutlined,
  KeyOutlined,
  LinkOutlined,
  LoadingOutlined,
  LogoutOutlined,
  MoonOutlined,
  QrcodeOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  SunOutlined,
} from "@ant-design/icons";

import { useSessionSocket } from "../hooks/useSessionSocket";
import { useWebRtcTransfer } from "../hooks/useWebRtcTransfer";
import type { SignalKind, TransferItem } from "../types";


interface WorkspaceProps {
  onLocked: () => void;
  onUnauthorized: () => void;
  onLogout: () => void;
}

type PairView = "qr" | "key";
type MobilePanel = "chat" | "files";

const KEY_ALPHABET = new Set("ABCDEFGHJKMNPQRSTUVWXYZ23456789_@$&".split(""));
const ACTIVE_TRANSFER_STATUSES = new Set<TransferItem["status"]>([
  "offered",
  "waiting",
  "sending",
  "receiving",
]);
const { Dragger } = Upload;


function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[index]}`;
}


function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}


function transferStatus(item: TransferItem): { color: string; text: string } {
  const labels: Record<TransferItem["status"], { color: string; text: string }> = {
    offered: { color: "gold", text: "等待接收" },
    waiting: { color: "blue", text: "等待对方确认" },
    sending: { color: "processing", text: "正在发送" },
    receiving: { color: "processing", text: "正在接收" },
    complete: { color: "success", text: "已完成" },
    cancelled: { color: "default", text: "已取消" },
    failed: { color: "error", text: "失败" },
  };
  return labels[item.status];
}


function Brand() {
  return (
    <div className="workspace-brand" aria-label="快分享">
      <span className="workspace-logo-mark" aria-hidden="true" />
      <span className="workspace-logo-text">快分享</span>
    </div>
  );
}


interface WorkspaceHeaderProps {
  connectionText: string;
  connectionTone: string;
  fileText?: string;
  fileTone?: string;
  darkMode: boolean;
  paired: boolean;
  hasActiveTransfer: boolean;
  onToggleTheme: () => void;
  onLeave: () => void;
  onLogout: () => void;
}


function WorkspaceHeader({
  connectionText,
  connectionTone,
  fileText,
  fileTone,
  darkMode,
  paired,
  hasActiveTransfer,
  onToggleTheme,
  onLeave,
  onLogout,
}: WorkspaceHeaderProps) {
  return (
    <header className="workspace-status-bar">
      <Brand />
      <div className="workspace-status-items">
        <div className="workspace-status-item">
          <span className={`workspace-status-dot ${connectionTone}`} aria-hidden="true" />
          <span>{connectionText}</span>
        </div>
        {fileText && (
          <div className="workspace-status-item workspace-file-status">
            <span className={`workspace-status-dot ${fileTone}`} aria-hidden="true" />
            <span>{fileText}</span>
          </div>
        )}
        <div className="workspace-privacy">
          <SafetyCertificateOutlined />
          <span>内容仅保留在当前页面</span>
        </div>
        <Tooltip title={darkMode ? "切换到浅色模式" : "切换到深色模式"}>
          <Button
            className="workspace-icon-button"
            type="text"
            icon={darkMode ? <SunOutlined /> : <MoonOutlined />}
            onClick={onToggleTheme}
            aria-label={darkMode ? "切换到浅色模式" : "切换到深色模式"}
          />
        </Tooltip>
        {paired ? (
          <Popconfirm
            title="断开当前配对？"
            description={
              hasActiveTransfer
                ? "断开将中止正在进行的文件传输，并结束当前聊天会话。"
                : "断开后将结束当前聊天会话，并生成新的配对码。"
            }
            okText="断开"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={onLeave}
          >
            <Button danger size="small" icon={<DisconnectOutlined />}>断开</Button>
          </Popconfirm>
        ) : (
          <Button type="text" size="small" icon={<LogoutOutlined />} onClick={onLogout}>
            退出
          </Button>
        )}
      </div>
    </header>
  );
}


export function Workspace(props: WorkspaceProps) {
  const [darkMode, setDarkMode] = useState(false);
  const workspaceTheme = useMemo(
    () => ({
      algorithm: darkMode ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: darkMode ? "#00e8a0" : "#00a86b",
        colorInfo: darkMode ? "#40a0f0" : "#2878d0",
        borderRadius: 10,
        fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      },
      components: {
        Button: {
          primaryShadow: "none",
          primaryColor: darkMode ? "#003d26" : "#ffffff",
          fontWeight: 600,
        },
        Input: {
          activeBorderColor: darkMode ? "#00e8a0" : "#00a86b",
          hoverBorderColor: darkMode ? "#00e8a0" : "#00a86b",
          activeShadow: darkMode
            ? "0 0 0 3px rgba(0, 232, 160, 0.08)"
            : "0 0 0 3px rgba(0, 168, 107, 0.08)",
        },
        Progress: {
          defaultColor: darkMode ? "#00e8a0" : "#00a86b",
          remainingColor: darkMode ? "#252538" : "#ddd8d0",
        },
        Segmented: {
          trackBg: darkMode ? "#111118" : "#ffffff",
          itemSelectedBg: darkMode ? "#00e8a0" : "#00a86b",
          itemSelectedColor: darkMode ? "#003d26" : "#ffffff",
          itemHoverBg: darkMode ? "#181824" : "#f0eeea",
        },
      },
    }),
    [darkMode],
  );

  return (
    <ConfigProvider theme={workspaceTheme}>
      <WorkspaceContent
        {...props}
        darkMode={darkMode}
        onToggleTheme={() => setDarkMode((current) => !current)}
      />
    </ConfigProvider>
  );
}


interface WorkspaceContentProps extends WorkspaceProps {
  darkMode: boolean;
  onToggleTheme: () => void;
}


function WorkspaceContent({
  onLocked,
  onUnauthorized,
  onLogout,
  darkMode,
  onToggleTheme,
}: WorkspaceContentProps) {
  const { message } = App.useApp();
  const [manualKey, setManualKey] = useState("");
  const [composer, setComposer] = useState("");
  const [pairView, setPairView] = useState<PairView>("qr");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("chat");
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const signalHandlerRef = useRef<
    ((kind: SignalKind, payload: Record<string, unknown>) => void) | undefined
  >(undefined);
  const notifyError = useCallback((text: string) => void message.error(text), [message]);
  const notifyInfo = useCallback((text: string) => void message.info(text), [message]);
  const receiveSignal = useCallback((kind: SignalKind, payload: Record<string, unknown>) => {
    signalHandlerRef.current?.(kind, payload);
  }, []);

  const session = useSessionSocket({
    onLocked,
    onUnauthorized,
    onError: notifyError,
    onInfo: notifyInfo,
    onSignal: receiveSignal,
  });
  const rtc = useWebRtcTransfer({
    pairInfo: session.pairInfo,
    iceServers: session.iceServers,
    maxFileSize: session.maxFileSize,
    sendSignal: session.sendSignal,
    onError: notifyError,
    onInfo: notifyInfo,
  });
  signalHandlerRef.current = rtc.handleSignal;

  const pairUrl = useMemo(
    () => session.pairKey
      ? `${window.location.origin}/?pair=${encodeURIComponent(session.pairKey)}`
      : "",
    [session.pairKey],
  );
  const hasActiveTransfer = rtc.transfers.some((item) => ACTIVE_TRANSFER_STATUSES.has(item.status));
  const pendingTransferCount = rtc.transfers.filter((item) =>
    ACTIVE_TRANSFER_STATUSES.has(item.status),
  ).length;

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [session.messages.length]);

  const sanitizeKey = (value: string) =>
    [...value.toUpperCase()]
      .filter((character) => KEY_ALPHABET.has(character))
      .slice(0, 8)
      .join("");

  const copyText = async (value: string, successText = "已复制") => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    message.success(successText);
  };

  const submitPair = () => {
    if (session.pair(manualKey)) setManualKey("");
  };

  const updateManualKey = (value: string) => {
    const nextValue = sanitizeKey(value);
    session.clearPairError();
    setManualKey(nextValue);
    if (nextValue.length === 8 && !session.pairing) {
      if (session.pair(nextValue)) setManualKey("");
    }
  };

  const submitMessage = () => {
    if (session.sendChat(composer)) setComposer("");
  };

  const connectionStatus = {
    connecting: { text: "正在连接", tone: "blue" },
    waiting: { text: "等待配对", tone: "green" },
    paired: { text: "已建立独占配对", tone: "green" },
    disconnected: { text: "正在重连", tone: "red" },
  }[session.connection];
  const rtcStatus = {
    idle: { text: "文件通道未连接", tone: "muted" },
    connecting: { text: "文件通道建立中", tone: "blue" },
    ready: { text: "文件通道可用", tone: "green" },
    failed: { text: "文件通道连接失败", tone: "red" },
  }[rtc.rtcState];
  const paired = session.connection === "paired";

  return (
    <main className={`cloudrop-workspace ${darkMode ? "theme-dark" : "theme-light"}`}>
      <WorkspaceHeader
        connectionText={connectionStatus.text}
        connectionTone={connectionStatus.tone}
        fileText={paired ? rtcStatus.text : undefined}
        fileTone={paired ? rtcStatus.tone : undefined}
        darkMode={darkMode}
        paired={paired}
        hasActiveTransfer={hasActiveTransfer}
        onToggleTheme={onToggleTheme}
        onLeave={session.leave}
        onLogout={onLogout}
      />

      {session.disconnectNotice && (
        <div className="disconnect-banner" role="status">
          <span>对端已断开配对连接，已为当前页面生成新的配对码。</span>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={session.dismissDisconnectNotice}
            aria-label="关闭断开提示"
          />
        </div>
      )}

      {paired ? (
        <>
          <div className="mobile-workspace-tabs">
            <Segmented
              block
              value={mobilePanel}
              onChange={(value) => setMobilePanel(value as MobilePanel)}
              options={[
                { label: "消息", value: "chat" },
                {
                  label: (
                    <span className="mobile-tab-label">
                      文件
                      <Badge count={pendingTransferCount} size="small" />
                    </span>
                  ),
                  value: "files",
                },
              ]}
            />
          </div>

          <div className="paired-workspace-body">
            <section
              className={`chat-panel ${mobilePanel !== "chat" ? "panel-hidden-mobile" : ""}`}
              aria-label="聊天消息"
            >
              <div className="workspace-panel-heading">
                <div>
                  <Typography.Title level={3}>消息</Typography.Title>
                  <Typography.Text type="secondary">文本与链接实时传递，不会写入服务器数据库</Typography.Text>
                </div>
                <Tag variant="filled" color="success">已配对</Tag>
              </div>

              <div className="messages-area" aria-live="polite">
                <div className="message-row system">
                  <div className="system-message">
                    <CheckCircleOutlined />
                    已建立配对连接，现在可以发送消息和文件
                  </div>
                </div>
                {session.messages.map((item) => (
                  <article className={`message-row ${item.direction}`} key={item.id}>
                    <div className="message-content">
                      <div className="message-bubble">
                        {item.kind === "link" ? (
                          <a className="message-link" href={item.content} target="_blank" rel="noreferrer">
                            <LinkOutlined />
                            {item.content}
                          </a>
                        ) : (
                          <span>{item.content}</span>
                        )}
                        <Tooltip title="复制">
                          <Button
                            className="message-copy-button"
                            type="text"
                            size="small"
                            icon={<CopyOutlined />}
                            onClick={() => void copyText(item.content, "消息已复制")}
                            aria-label="复制消息"
                          />
                        </Tooltip>
                      </div>
                      <time className="message-time" dateTime={new Date(item.createdAt).toISOString()}>
                        {formatTime(item.createdAt)}
                      </time>
                    </div>
                  </article>
                ))}
                <div ref={messageEndRef} />
              </div>

              <div className="message-composer">
                <Input.TextArea
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      submitMessage();
                    }
                  }}
                  autoSize={{ minRows: 2, maxRows: 5 }}
                  maxLength={65536}
                  placeholder="输入消息或以 http://、https:// 开头的链接"
                  aria-label="消息内容"
                />
                <div className="composer-actions">
                  <span>Enter 换行 · Ctrl+Enter 发送</span>
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    onClick={submitMessage}
                    disabled={!composer.trim()}
                  >
                    发送
                  </Button>
                </div>
              </div>
            </section>

            <section
              className={`file-panel ${mobilePanel !== "files" ? "panel-hidden-mobile" : ""}`}
              aria-label="文件传输"
            >
              <div className="workspace-panel-heading">
                <div>
                  <Typography.Title level={3}>文件传输</Typography.Title>
                  <Typography.Text type="secondary">浏览器直连，必要时由 TURN 实时中继</Typography.Text>
                </div>
                <Tag variant="filled">单文件 ≤ {formatBytes(session.maxFileSize)}</Tag>
              </div>

              <div className="file-panel-content">
                <Dragger
                  className="file-dropzone"
                  beforeUpload={(file) => {
                    rtc.offerFile(file);
                    return Upload.LIST_IGNORE;
                  }}
                  showUploadList={false}
                  maxCount={1}
                  multiple={false}
                  disabled={rtc.rtcState !== "ready"}
                  styles={{ root: { width: "100%" }, trigger: { width: "100%" } }}
                >
                  <InboxOutlined className="file-drop-icon" />
                  <div className="file-drop-title">拖放文件到此处，或点击选择</div>
                  <div className="file-drop-hint">
                    {rtc.rtcState === "ready" ? "一次处理一个发送任务" : "正在等待文件通道就绪"}
                  </div>
                </Dragger>

                <div className="transfer-list" aria-live="polite">
                  {rtc.transfers.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无文件传输" />
                  ) : (
                    [...rtc.transfers].reverse().map((item) => {
                      const status = transferStatus(item);
                      const active = ACTIVE_TRANSFER_STATUSES.has(item.status);
                      return (
                        <article className="transfer-item" key={item.id}>
                          <div className="transfer-heading">
                            <span className={`transfer-file-icon ${item.direction}`}>
                              <FileOutlined />
                            </span>
                            <div className="transfer-name">
                              <Typography.Text ellipsis={{ tooltip: item.name }}>{item.name}</Typography.Text>
                              <Typography.Text type="secondary">
                                {item.direction === "sent" ? "↑ 发送" : "↓ 接收"} · {formatBytes(item.size)}
                              </Typography.Text>
                            </div>
                            <Tag variant="filled" color={status.color}>{status.text}</Tag>
                          </div>

                          {(["waiting", "sending", "receiving"].includes(item.status)
                            || item.status === "complete") && (
                            <div className="transfer-progress">
                              <Progress percent={item.progress} showInfo={false} size="small" />
                              <div className="transfer-progress-meta">
                                <span>{item.progress}%</span>
                                <span>{item.speed > 0 && active ? `${formatBytes(item.speed)}/s` : status.text}</span>
                              </div>
                            </div>
                          )}

                          {item.error && <Typography.Text type="danger">{item.error}</Typography.Text>}

                          <div className="transfer-actions">
                            {item.status === "offered" && (
                              <>
                                <Button type="primary" size="small" onClick={() => void rtc.acceptFile(item.id)}>
                                  接收
                                </Button>
                                <Button size="small" onClick={() => rtc.rejectFile(item.id)}>拒绝</Button>
                              </>
                            )}
                            {active && item.status !== "offered" && (
                              <Button danger type="text" size="small" onClick={() => rtc.cancelTransfer(item.id)}>
                                取消
                              </Button>
                            )}
                            {item.status === "complete" && item.direction === "sent" && (
                              <span className="transfer-complete-note"><CheckCircleOutlined /> 传输完成</span>
                            )}
                            {item.status === "complete" && item.direction === "received" && item.savedDirectly && (
                              <span className="transfer-complete-note"><CheckCircleOutlined /> 已直接保存</span>
                            )}
                            {item.downloadUrl && (
                              <a
                                className="download-link"
                                href={item.downloadUrl}
                                download={item.name}
                                onClick={() => rtc.releaseReceived(item.id)}
                              >
                                <DownloadOutlined />
                                保存文件
                              </a>
                            )}
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </div>
            </section>
          </div>
        </>
      ) : session.connection === "waiting" && session.pairKey ? (
        <section className="pair-page">
          <div className="pair-workspace">
            <Segmented
              className="pair-view-toggle"
              value={pairView}
              onChange={(value) => setPairView(value as PairView)}
              options={[
                { label: "二维码", value: "qr", icon: <QrcodeOutlined /> },
                { label: "配对码", value: "key", icon: <KeyOutlined /> },
              ]}
            />

            <div className="pair-view-viewport">
              {pairView === "qr" ? (
                <div className="qr-view">
                  <QRCode
                    value={pairUrl}
                    size={240}
                    errorLevel="M"
                    status="active"
                    bordered={false}
                    marginSize={2}
                    color={darkMode ? "#e4e4f0" : "#1a1a2e"}
                    bgColor={darkMode ? "#111118" : "#ffffff"}
                  />
                  <Button type="text" size="small" onClick={() => void copyText(pairUrl, "配对链接已复制")}>
                    复制配对链接
                  </Button>
                </div>
              ) : (
                <div className="key-view">
                  <div className="key-label">我的配对码</div>
                  <button
                    type="button"
                    className="key-characters"
                    onClick={() => void copyText(session.pairKey, "配对码已复制")}
                    aria-label="复制配对码"
                  >
                    {session.pairKey.split("").map((character, index) => (
                      <span className="key-character" key={`${character}-${index}`}>{character}</span>
                    ))}
                  </button>
                  <Button icon={<CopyOutlined />} onClick={() => void copyText(session.pairKey, "配对码已复制")}>
                    复制配对码
                  </Button>
                </div>
              )}
            </div>

            <div className="pair-view-hint">页面保持在线才能接收配对</div>

            <div className="pair-divider"><span>输入对方配对码</span></div>

            <div className="pair-input-section">
              {session.pairing ? (
                <div className="pair-state-row pairing" role="status">
                  <LoadingOutlined spin />
                  <span>正在配对...</span>
                </div>
              ) : (
                <div className="pair-input-row">
                  <Input
                    className="pair-code-input"
                    size="large"
                    value={manualKey}
                    onChange={(event) => updateManualKey(event.target.value)}
                    onPressEnter={submitPair}
                    maxLength={8}
                    status={session.pairError ? "error" : undefined}
                    placeholder="输入 8 位码"
                    aria-label="对方配对码"
                  />
                </div>
              )}
              {session.pairError && <div className="pair-error" role="alert">{session.pairError}</div>}
            </div>
          </div>
        </section>
      ) : (
        <section className="workspace-connection-state">
          <CloudSyncOutlined spin />
          <strong>{session.connection === "disconnected" ? "实时连接已中断" : "正在建立实时连接"}</strong>
          <span>{session.connection === "disconnected" ? "快分享 正在自动重试，请保持页面开启" : "正在准备安全的配对通道"}</span>
        </section>
      )}
    </main>
  );
}

export type ConnectionState = "connecting" | "waiting" | "paired" | "disconnected";

export type ChatKind = "text" | "link";

export interface ChatMessage {
  id: string;
  kind: ChatKind;
  content: string;
  direction: "sent" | "received";
  createdAt: number;
}

export interface PairInfo {
  version: number;
  initiator: boolean;
}

export type SignalKind = "offer" | "answer" | "ice";

export type TransferStatus =
  | "offered"
  | "waiting"
  | "sending"
  | "receiving"
  | "complete"
  | "cancelled"
  | "failed";

export interface TransferItem {
  id: string;
  name: string;
  size: number;
  mime: string;
  direction: "sent" | "received";
  status: TransferStatus;
  progress: number;
  speed: number;
  error?: string;
  downloadUrl?: string;
  savedDirectly?: boolean;
}

export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  mime: string;
}


/**
 * chatSocket.ts — typed socket factory for the chat + call module.
 */
import { io, Socket } from "socket.io-client";
import type { ChatMessage, ChatUser } from "@/types/chat";

// ── Event maps ──────────────────────────────────────────────────────────────

export interface ServerToClientEvents {
  // Chat
  "message-history": (history: ChatMessage[]) => void;
  "receive-message": (msg: ChatMessage) => void;
  "users-update":    (users: ChatUser[]) => void;
  
  // Typing
  "typing-update": (data: { username: string; isTyping: boolean; room: string }) => void;
  
  // Receipts
  "message-status-update": (data: { messageId: string; status: "sent" | "delivered" | "read"; room: string }) => void;

  // WebRTC signaling (received)
  "incoming-call": (data: { from: string; fromUsername: string; offer: RTCSessionDescriptionInit; isReconnect?: boolean }) => void;
  "call-answered": (data: { from: string; answer: RTCSessionDescriptionInit }) => void;
  "call-rejected": (data: { from: string }) => void;
  "call-ended":    (data: { from: string }) => void;
  "ice-candidate": (data: { from: string; candidate: RTCIceCandidateInit }) => void;
  "mic-gain-change": (data: { gain: number }) => void;
}

export interface ClientToServerEvents {
  // Chat
  "send-message": (text: string) => void;
  "get-users":    () => void;
  
  // Rooms
  "join-room":    (roomName: string) => void;
  
  // Typing
  "typing":       (isTyping: boolean) => void;
  
  // Receipts
  "message-delivered": (data: { messageId: string; senderName: string; room: string }) => void;
  "message-read":      (data: { messageId: string; senderName: string; room: string }) => void;

  // WebRTC signaling (sent)
  "call-user":     (data: { to: string; offer: RTCSessionDescriptionInit; isReconnect?: boolean }) => void;
  "call-answer":   (data: { to: string; answer: RTCSessionDescriptionInit }) => void;
  "call-rejected": (data: { to: string }) => void;
  "call-ended":    (data: { to: string }) => void;
  "ice-candidate": (data: { to: string; candidate: RTCIceCandidateInit }) => void;
  "mic-gain-change": (data: { to: string; gain: number }) => void;
  "log-call":      (data: { room: string; callDetails: any }) => void;
}

export type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// ── Factory ─────────────────────────────────────────────────────────────────

export function createChatSocket(token: string): ChatSocket {
  const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
  return io(socketUrl, {
    auth: { token },
    transports: ["websocket"],
  });
}

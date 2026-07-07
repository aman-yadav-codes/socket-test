/**
 * chatSocket.ts — typed socket factory for the chat + call module.
 */
import { io, Socket } from "socket.io-client";
import type { ChatMessage, ChatUser } from "@/types/chat";
import type { CallType } from "@/types/call";

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

  // WebRTC generic signaling (received)
  "call:start": (data: { from: string; fromUsername: string; offer: RTCSessionDescriptionInit; callType: CallType }) => void;
  "call:answer": (data: { from: string; answer: RTCSessionDescriptionInit }) => void;
  "call:reject": (data: { from: string }) => void;
  "call:end":    (data: { from: string }) => void;
  "call:ice-candidate": (data: { from: string; candidate: RTCIceCandidateInit }) => void;
  "call:mic-gain": (data: { gain: number }) => void;
  "call:media-toggle": (data: { from: string; audioEnabled: boolean; videoEnabled: boolean }) => void;
  "call:upgrade-request": (data: { from: string; offer: RTCSessionDescriptionInit }) => void;
  "call:upgrade-response": (data: { from: string; answer?: RTCSessionDescriptionInit; accepted: boolean }) => void;
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

  // WebRTC generic signaling (sent)
  "call:start":     (data: { to: string; offer: RTCSessionDescriptionInit; callType: CallType }) => void;
  "call:answer":   (data: { to: string; answer: RTCSessionDescriptionInit }) => void;
  "call:reject": (data: { to: string }) => void;
  "call:end":    (data: { to: string }) => void;
  "call:ice-candidate": (data: { to: string; candidate: RTCIceCandidateInit }) => void;
  "call:mic-gain": (data: { to: string; gain: number }) => void;
  "call:media-toggle": (data: { to: string; audioEnabled: boolean; videoEnabled: boolean }) => void;
  "call:upgrade-request": (data: { to: string; offer: RTCSessionDescriptionInit }) => void;
  "call:upgrade-response": (data: { to: string; answer?: RTCSessionDescriptionInit; accepted: boolean }) => void;
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

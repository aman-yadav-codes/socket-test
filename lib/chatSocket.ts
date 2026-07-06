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

  // WebRTC signaling (received)
  "incoming-call": (data: { from: string; fromUsername: string; offer: RTCSessionDescriptionInit }) => void;
  "call-answered": (data: { from: string; answer: RTCSessionDescriptionInit }) => void;
  "call-rejected": (data: { from: string }) => void;
  "call-ended":    (data: { from: string }) => void;
  "ice-candidate": (data: { from: string; candidate: RTCIceCandidateInit }) => void;
}

export interface ClientToServerEvents {
  // Chat
  "send-message": (text: string) => void;
  "get-users":    () => void;

  // WebRTC signaling (sent)
  "call-user":     (data: { to: string; offer: RTCSessionDescriptionInit }) => void;
  "call-answer":   (data: { to: string; answer: RTCSessionDescriptionInit }) => void;
  "call-rejected": (data: { to: string }) => void;
  "call-ended":    (data: { to: string }) => void;
  "ice-candidate": (data: { to: string; candidate: RTCIceCandidateInit }) => void;
}

export type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// ── Factory ─────────────────────────────────────────────────────────────────

export function createChatSocket(username: string): ChatSocket {
  return io({
    path: "/api/socket",
    addTrailingSlash: false,
    query: { username },
    transports: ["websocket"],
  });
}

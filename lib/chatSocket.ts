/**
 * chatSocket.ts
 * Creates a typed, per-user Socket.IO client instance for the chat module.
 * Each call returns a NEW socket (no singleton) — lifetime is managed by useChat.
 */
import { io, Socket } from "socket.io-client";
import type { ChatMessage, ChatUser } from "@/types/chat";

// Typed event map — keeps event names and payloads in one place.
// If the server API changes, update only here.
export interface ServerToClientEvents {
  "message-history": (history: ChatMessage[]) => void;
  "receive-message": (msg: ChatMessage) => void;
  "users-update": (users: ChatUser[]) => void;
}

export interface ClientToServerEvents {
  "send-message": (text: string) => void;
  "get-users": () => void;
}

export type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createChatSocket(username: string): ChatSocket {
  return io({
    path: "/api/socket",
    addTrailingSlash: false,
    query: { username },
    transports: ["websocket"],
  });
}

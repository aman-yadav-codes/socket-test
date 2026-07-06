/**
 * useChat.ts
 * Central hook for the chat module. Manages:
 *  - Socket lifecycle (connect / disconnect)
 *  - In-memory message list (history + real-time + optimistic dedup)
 *  - Connected users list
 *  - Notification sound (preloaded, reused)
 *  - Toast notifications with target message ID for scroll-to-message
 *
 * Drop this hook into any component tree by calling:
 *   const chat = useChat({ username });
 */
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createChatSocket, ChatSocket } from "@/lib/chatSocket";
import type { ChatMessage, ChatUser } from "@/types/chat";

export interface ToastData {
  text: string;
  /** ID of the ChatMessage that triggered this toast — used for scroll-to. */
  messageId: string;
}

export interface UseChatReturn {
  // Connection
  isConnected: boolean;
  socketId: string;

  // Messages
  messages: ChatMessage[];
  /** Ref map from message.id → DOM element. Populated by MessageBubble. */
  messageRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  /** Scroll to a message by ID and flash-highlight it. */
  scrollToMessage: (id: string) => void;

  // Users
  connectedUsers: ChatUser[];

  // Input
  input: string;
  setInput: (v: string) => void;
  sendMessage: () => void;

  // Sound
  soundEnabled: boolean;
  toggleSound: () => void;

  // Toast
  toast: ToastData | null;
  isToastVisible: boolean;
  dismissToast: () => void;
}

interface UseChatOptions {
  username: string;
}

export function useChat({ username }: UseChatOptions): UseChatReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [socketId, setSocketId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connectedUsers, setConnectedUsers] = useState<ChatUser[]>([]);
  const [input, setInput] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [isToastVisible, setIsToastVisible] = useState(false);

  const socketRef = useRef<ChatSocket | null>(null);
  const soundEnabledRef = useRef(soundEnabled);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const toastLeaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  /** Map from message.id → DOM div for scroll-to-message. Populated by MessageBubble. */
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Keep soundEnabledRef in sync
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  // Preload notification sound once on mount
  useEffect(() => {
    audioRef.current = new Audio("/sounds/notification.mp3");
    audioRef.current.load();
    return () => {
      audioRef.current = null;
    };
  }, []);

  const playSound = useCallback(() => {
    if (!soundEnabledRef.current || !audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});
  }, []);

  const showToast = useCallback((data: ToastData) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (toastLeaveTimerRef.current) clearTimeout(toastLeaveTimerRef.current);

    setToast(data);
    setIsToastVisible(true);

    toastLeaveTimerRef.current = setTimeout(() => setIsToastVisible(false), 2700);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (toastLeaveTimerRef.current) clearTimeout(toastLeaveTimerRef.current);
    setIsToastVisible(false);
    setTimeout(() => setToast(null), 350);
  }, []);

  /** Scroll the message list to the given message ID and apply highlight. */
  const scrollToMessage = useCallback((id: string) => {
    const el = messageRefs.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Trigger highlight: remove → force reflow → re-add
    el.classList.remove("animate-highlight");
    void el.offsetHeight; // reflow
    el.classList.add("animate-highlight");
    // Clean up class after animation
    el.addEventListener("animationend", () => el.classList.remove("animate-highlight"), { once: true });
  }, []);

  // Socket lifecycle — recreates when username changes
  useEffect(() => {
    if (!username) return;

    const socket = createChatSocket(username);
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      setSocketId(socket.id ?? "");
      socket.emit("get-users");
    });

    socket.on("disconnect", () => setIsConnected(false));

    socket.on("message-history", (history) => {
      setMessages(history);
    });

    socket.on("receive-message", (msg) => {
      setMessages((prev) => {
        // Replace optimistic placeholder from same sender with the canonical server copy
        const idx = prev.findIndex(
          (m) =>
            m.id?.startsWith("optimistic-") &&
            m.sender === username &&
            msg.sender === username &&
            m.text === msg.text
        );
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = msg;
          return next;
        }
        return [...prev, msg];
      });

      // Notify only for other users' messages
      if (msg.sender !== username) {
        playSound();
        showToast({ text: `${msg.sender}: ${msg.text}`, messageId: msg.id });
      }
    });

    socket.on("users-update", setConnectedUsers);

    if (socket.connected) {
      setIsConnected(true);
      setSocketId(socket.id ?? "");
      socket.emit("get-users");
    }

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [username, playSound, showToast]);

  const sendMessage = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || !socketRef.current) return;

    const optimistic: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      text: trimmed,
      sender: username,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimistic]);
    socketRef.current.emit("send-message", trimmed);
    playSound();
    setInput("");
  }, [input, username, playSound]);

  const toggleSound = useCallback(() => setSoundEnabled((v) => !v), []);

  return {
    isConnected,
    socketId,
    messages,
    messageRefs,
    scrollToMessage,
    connectedUsers,
    input,
    setInput,
    sendMessage,
    soundEnabled,
    toggleSound,
    toast,
    isToastVisible,
    dismissToast,
  };
}

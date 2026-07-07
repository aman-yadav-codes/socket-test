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
  /** Live socket instance — pass to useWebRTC for signaling. null until connected. */
  socket: ChatSocket | null;
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

  // Rooms
  room: string;
  joinRoom: (roomName: string) => void;

  // Typing
  typingUsers: string[];
  sendTypingStatus: (isTyping: boolean) => void;

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
  const [socket, setSocket] = useState<ChatSocket | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [isToastVisible, setIsToastVisible] = useState(false);

  // New States
  const [room, setRoom] = useState("general");
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [token, setToken] = useState<string | null>(null);

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
    el.classList.remove("animate-highlight");
    void el.offsetHeight; // reflow
    el.classList.add("animate-highlight");
    el.addEventListener("animationend", () => el.classList.remove("animate-highlight"), { once: true });
  }, []);

  // Fetch JWT token when username changes
  useEffect(() => {
    if (!username) {
      setToken(null);
      return;
    }

    const cachedToken = sessionStorage.getItem(`chat_token_${username}`);
    if (cachedToken) {
      setToken(cachedToken);
      return;
    }

    let active = true;
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
    console.log(`[auth] Fetching JWT for ${username} from ${socketUrl}`);

    fetch(`${socketUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Auth request failed");
        return res.json();
      })
      .then((data) => {
        if (active && data.token) {
          sessionStorage.setItem(`chat_token_${username}`, data.token);
          setToken(data.token);
        }
      })
      .catch((err) => {
        console.error("[auth] Token fetch error:", err);
      });

    return () => {
      active = false;
    };
  }, [username]);

  // Socket lifecycle — recreates when token or room changes
  useEffect(() => {
    if (!token || !username) return;

    const socket = createChatSocket(token);
    socketRef.current = socket;
    setSocket(socket);

    socket.on("connect", () => {
      setIsConnected(true);
      setSocketId(socket.id ?? "");
      socket.emit("join-room", room);
      socket.emit("get-users");
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
      setTypingUsers([]);
    });

    socket.on("message-history", (history) => {
      setMessages(history);
      
      // Send read receipts for historical messages sent by others
      history.forEach((msg) => {
        if (msg.sender !== username && msg.status !== "read") {
          socket.emit("message-read", { messageId: msg.id, senderName: msg.sender, room });
        }
      });
    });

    socket.on("receive-message", (msg) => {
      if (msg.room && msg.room !== room) return; // Ignore if message is for another room
      
      setMessages((prev) => {
        // Replace optimistic placeholder from same sender with canonical server copy
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

      // Send receipts for messages from other users
      if (msg.sender !== username) {
        socket.emit("message-delivered", { messageId: msg.id, senderName: msg.sender, room: msg.room || "general" });
        socket.emit("message-read", { messageId: msg.id, senderName: msg.sender, room: msg.room || "general" });
        playSound();
        showToast({ text: `${msg.sender}: ${msg.text}`, messageId: msg.id });
      }
    });

    socket.on("message-status-update", ({ messageId, status }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, status } : m))
      );
    });

    socket.on("typing-update", ({ username: typingUser, isTyping, room: typingRoom }) => {
      if (typingRoom !== room) return;
      setTypingUsers((prev) => {
        if (isTyping) {
          if (prev.includes(typingUser)) return prev;
          return [...prev, typingUser];
        } else {
          return prev.filter((u) => u !== typingUser);
        }
      });
    });

    socket.on("users-update", setConnectedUsers);

    if (socket.connected) {
      setIsConnected(true);
      setSocketId(socket.id ?? "");
      socket.emit("join-room", room);
      socket.emit("get-users");
    }

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setSocket(null);
      setTypingUsers([]);
    };
  }, [token, username, room, playSound, showToast]);

  const joinRoom = useCallback((roomName: string) => {
    if (!roomName || roomName === room) return;
    setRoom(roomName);
    setTypingUsers([]);
    setMessages([]);
    if (socketRef.current) {
      socketRef.current.emit("join-room", roomName);
    }
  }, [room]);

  const sendTypingStatus = useCallback((isTyping: boolean) => {
    if (socketRef.current) {
      socketRef.current.emit("typing", isTyping);
    }
  }, []);

  const sendMessage = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || !socketRef.current) return;

    const optimistic: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      text: trimmed,
      sender: username,
      timestamp: new Date().toISOString(),
      room: room,
      status: "sent"
    };

    setMessages((prev) => [...prev, optimistic]);
    socketRef.current.emit("send-message", trimmed);
    socketRef.current.emit("typing", false);
    playSound();
    setInput("");
  }, [input, username, room, playSound]);

  const toggleSound = useCallback(() => setSoundEnabled((v) => !v), []);

  return {
    socket,
    isConnected,
    socketId,
    messages,
    messageRefs,
    scrollToMessage,
    connectedUsers,
    room,
    joinRoom,
    typingUsers,
    sendTypingStatus,
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

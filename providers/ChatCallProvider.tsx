/**
 * ChatCallProvider.tsx
 * Global React Context Provider for the chat and WebRTC call state.
 *
 * Placed at the root layout level, this provider:
 *  - Persists the Socket.IO connection and WebRTC call status across page navigations.
 *  - Stores the nickname in sessionStorage to automatically log back in after a physical page reload.
 */
"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useChat, UseChatReturn } from "@/hooks/useChat";
import { useWebRTC, UseWebRTCReturn } from "@/hooks/useWebRTC";

interface ChatCallContextType {
  username: string;
  setUsername: (v: string) => void;
  isNameEntered: boolean;
  setIsNameEntered: (v: boolean) => void;
  chat: UseChatReturn | null;
  webrtc: UseWebRTCReturn | null;
}

const ChatCallContext = createContext<ChatCallContextType | null>(null);

export function ChatCallProvider({ children }: { children: React.ReactNode }) {
  const [username, setUsernameState] = useState("");
  const [isNameEntered, setIsNameEntered] = useState(false);

  // Load username from sessionStorage on mount to survive physical page reloads
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem("chat_username");
      if (saved) {
        setUsernameState(saved);
        setIsNameEntered(true);
      }
    }
  }, []);

  const setUsername = (name: string) => {
    setUsernameState(name);
    if (name) {
      sessionStorage.setItem("chat_username", name);
      setIsNameEntered(true);
    } else {
      sessionStorage.removeItem("chat_username");
      setIsNameEntered(false);
    }
  };

  // Instantiate Chat and WebRTC state at layout level
  const chatState = useChat({ username });
  const webrtcState = useWebRTC({
    socket: chatState.socket,
    socketId: chatState.socketId,
    username,
  });

  return (
    <ChatCallContext.Provider
      value={{
        username,
        setUsername,
        isNameEntered,
        setIsNameEntered,
        chat: isNameEntered ? chatState : null,
        webrtc: isNameEntered ? webrtcState : null,
      }}
    >
      {children}
    </ChatCallContext.Provider>
  );
}

export function useChatCall() {
  const context = useContext(ChatCallContext);
  if (!context) {
    throw new Error("useChatCall must be used within a ChatCallProvider");
  }
  return context;
}

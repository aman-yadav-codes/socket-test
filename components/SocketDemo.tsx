/**
 * SocketDemo.tsx
 * Demo entry point — handles the join flow then renders ChatRoom.
 * This thin wrapper is the only place that manages the "has user joined?" state.
 *
 * To use the chat in another project, copy the /components/chat module,
 * /hooks/useChat.ts, /lib/chatSocket.ts, and /types/chat.ts, then render:
 *
 *   <JoinScreen ... />  →  <ChatRoom username={name} />
 */
"use client";

import { useState } from "react";
import { ChatRoom, JoinScreen } from "@/components/chat";

export default function SocketDemo() {
  const [username, setUsername] = useState("");
  const [nameInput, setNameInput] = useState("");

  if (!username) {
    return (
      <JoinScreen
        value={nameInput}
        onChange={setNameInput}
        onJoin={() => {
          const trimmed = nameInput.trim();
          if (trimmed) setUsername(trimmed);
        }}
      />
    );
  }

  return <ChatRoom username={username} />;
}

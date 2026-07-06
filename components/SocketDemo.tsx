/**
 * SocketDemo.tsx
 * Entry wrapper for the chat demo. Consumes global ChatCall provider context
 * to decide whether to show the Join Screen or the Chat Room.
 */
"use client";

import { useState } from "react";
import { useChatCall } from "@/providers/ChatCallProvider";
import { ChatRoom, JoinScreen } from "@/components/chat";

export default function SocketDemo() {
  const { username, setUsername, isNameEntered } = useChatCall();
  const [nameInput, setNameInput] = useState("");

  if (!isNameEntered) {
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

/**
 * MessageList.tsx
 * Scrollable message list.
 * - Registers each bubble's DOM ref into the shared messageRefs map (from useChat).
 * - Auto-scrolls to bottom on new messages.
 */
"use client";

import { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble";
import type { ChatMessage } from "@/types/chat";

interface Props {
  messages: ChatMessage[];
  username: string;
  /** Ref map from useChat — we populate it so scrollToMessage can find DOM nodes. */
  messageRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
}

export default function MessageList({ messages, username, messageRefs }: Props) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="h-[300px] w-full rounded-md border p-4 bg-white dark:bg-zinc-900 overflow-y-auto flex flex-col gap-2">
      {messages.length === 0 ? (
        <p className="text-zinc-400 text-sm text-center m-auto select-none">
          No messages yet…
        </p>
      ) : (
      messages.map((msg, index) => (
          <MessageBubble
            key={msg.id || String(index)}
            message={msg}
            isSelf={msg.sender === username}
            ref={(el) => {
              if (el) messageRefs.current.set(msg.id, el);
              else messageRefs.current.delete(msg.id);
            }}
          />
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}

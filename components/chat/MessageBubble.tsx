/**
 * MessageBubble.tsx
 * A single chat message bubble.
 * Uses forwardRef so the parent (MessageList) can store a DOM ref keyed by message.id,
 * enabling the scroll-to-message + highlight feature triggered by toast clicks.
 */
import { forwardRef } from "react";
import type { ChatMessage } from "@/types/chat";

interface Props {
  message: ChatMessage;
  /** Whether this message was sent by the local user. */
  isSelf: boolean;
}

const MessageBubble = forwardRef<HTMLDivElement, Props>(({ message, isSelf }, ref) => {
  return (
    <div
      ref={ref}
      className={`
        p-2.5 rounded-xl text-sm animate-msg flex flex-col gap-0.5 transition-colors
        ${isSelf
          ? "bg-zinc-100 dark:bg-zinc-800 self-end max-w-[80%]"
          : "bg-blue-50 dark:bg-blue-900/20 self-start max-w-[80%]"
        }
      `}
    >
      {!isSelf && (
        <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 mb-0.5 leading-none">
          {message.sender}
        </span>
      )}
      <span className="break-words leading-relaxed">{message.text}</span>
      <div className="flex items-center gap-1 self-end mt-0.5 select-none">
        <span className="text-[9px] text-zinc-400 tabular-nums">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {isSelf && (
          <span className="text-[10px] font-bold leading-none select-none">
            {message.status === "read" ? (
              <span className="text-blue-500 dark:text-blue-400">✓✓</span>
            ) : message.status === "delivered" ? (
              <span className="text-zinc-400 dark:text-zinc-500">✓✓</span>
            ) : (
              <span className="text-zinc-400 dark:text-zinc-500">✓</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
});

MessageBubble.displayName = "MessageBubble";
export default MessageBubble;

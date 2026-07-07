import { forwardRef } from "react";
import type { ChatMessage } from "@/types/chat";
import { Phone, PhoneCall, PhoneMissed, PhoneOff } from "lucide-react";

interface Props {
  message: ChatMessage;
  /** Whether this message was sent by the local user. */
  isSelf: boolean;
}

const MessageBubble = forwardRef<HTMLDivElement, Props>(({ message, isSelf }, ref) => {
  const isCall = message.type === "call";

  if (isCall && message.callDetails) {
    const { caller, receiver, status, duration } = message.callDetails;
    
    // Choose icon and styles based on call outcome
    let Icon = Phone;
    let iconColor = "text-emerald-500";
    let statusText = "Voice Call";
    let bgClass = "bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800";

    if (status === "missed") {
      Icon = PhoneMissed;
      iconColor = "text-amber-500";
      statusText = "Missed Call";
    } else if (status === "declined") {
      Icon = PhoneOff;
      iconColor = "text-red-500";
      statusText = "Declined Call";
    } else if (status === "answered") {
      Icon = PhoneCall;
      iconColor = "text-emerald-500";
      statusText = `Voice Call (${duration || "00:00"})`;
    }

    return (
      <div
        ref={ref}
        className={`p-3 rounded-2xl animate-msg flex items-center gap-3 self-center max-w-[90%] shadow-sm ${bgClass}`}
      >
        <div className={`p-2 rounded-xl bg-zinc-100/80 dark:bg-zinc-800 shrink-0 ${iconColor}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex flex-col min-w-0">
          <p className="font-semibold text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider leading-none">
            {statusText}
          </p>
          <p className="text-sm text-zinc-800 dark:text-zinc-200 mt-1 font-medium leading-tight">
            {caller} called <span className="font-bold">{receiver}</span>
          </p>
          <span className="text-[9px] text-zinc-400 tabular-nums mt-1 select-none">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>
    );
  }

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

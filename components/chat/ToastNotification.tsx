/**
 * ToastNotification.tsx
 * WhatsApp-style slide-in notification toast.
 *
 * Clicking anywhere on the toast calls onMessageClick, which triggers
 * scrollToMessage in the parent — scrolling to and highlighting the message.
 */
"use client";

import type { ToastData } from "@/hooks/useChat";

interface Props {
  toast: ToastData;
  isVisible: boolean;
  onDismiss: () => void;
  /** Called when user clicks the toast body — used to scroll to the message. */
  onMessageClick: (messageId: string) => void;
}

export default function ToastNotification({
  toast,
  isVisible,
  onDismiss,
  onMessageClick,
}: Props) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className={`
        fixed bottom-4 right-4 z-50 max-w-sm w-full
        bg-white dark:bg-zinc-900
        border border-zinc-200 dark:border-zinc-800
        rounded-xl shadow-2xl overflow-hidden
        ${isVisible ? "animate-slide-in" : "animate-slide-out"}
      `}
    >
      {/* Clickable body — scroll to message */}
      <button
        onClick={() => {
          onMessageClick(toast.messageId);
          onDismiss();
        }}
        className="w-full text-left p-4 flex gap-3 items-start cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors group"
        aria-label="Go to message"
      >
        {/* Emerald accent bar */}
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500 rounded-l-xl" />

        <div className="flex-1 ml-2 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">
              New Message
            </span>
            <span className="ml-auto text-[10px] text-zinc-400 group-hover:text-emerald-500 transition-colors whitespace-nowrap">
              Click to view ↗
            </span>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-300 truncate leading-snug">
            {toast.text}
          </p>
        </div>
      </button>

      {/* Dismiss ✕ */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="absolute top-2 right-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 text-xs leading-none p-1 rounded cursor-pointer transition-colors"
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}

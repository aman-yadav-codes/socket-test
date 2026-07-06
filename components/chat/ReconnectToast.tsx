/**
 * ReconnectToast.tsx
 * Floating manual reconnect prompt toast displaying a 5-second countdown timer.
 * If clicked, it invokes the onReconnect callback to redial the target user.
 */
"use client";

import { useState, useEffect } from "react";
import { PhoneCall, X } from "lucide-react";

interface Props {
  targetUsername: string;
  isOnline: boolean;
  onReconnect: () => void;
  onDismiss: () => void;
}

export default function ReconnectToast({ targetUsername, isOnline, onReconnect, onDismiss }: Props) {
  const [timeLeft, setTimeLeft] = useState(5);

  useEffect(() => {
    // Sync initial time left with localStorage timestamp
    const savedTime = sessionStorage.getItem("last_call_timestamp");
    if (savedTime) {
      const elapsed = Date.now() - parseInt(savedTime, 10);
      const remaining = Math.max(0, Math.ceil((5000 - elapsed) / 1000));
      setTimeLeft(remaining);
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onDismiss();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onDismiss]);

  if (timeLeft <= 0) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 w-80 animate-slide-in"
    >
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-4 flex flex-col gap-3 relative">
        <button
          onClick={onDismiss}
          className="absolute top-2.5 right-2.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
          aria-label="Dismiss toast"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col">
          <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">
            Call Disconnected
          </p>
          <p className="font-semibold text-zinc-800 dark:text-zinc-200 text-sm mt-0.5 leading-snug">
            Reconnect call with <span className="text-emerald-500 font-bold">{targetUsername}</span>?
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 w-full">
          <button
            onClick={onDismiss}
            className="flex-1 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-xs font-semibold transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onReconnect}
            disabled={!isOnline}
            className={`flex-1 py-2 rounded-xl text-white text-xs font-semibold transition-colors shadow-md flex items-center justify-center gap-1.5 ${
              isOnline
                ? "bg-emerald-500 hover:bg-emerald-600 cursor-pointer"
                : "bg-zinc-300 dark:bg-zinc-700 cursor-not-allowed text-zinc-500"
            }`}
          >
            <PhoneCall className="h-3 w-3" />
            {isOnline ? `Reconnect (${timeLeft}s)` : "Connecting..."}
          </button>
        </div>
      </div>
    </div>
  );
}

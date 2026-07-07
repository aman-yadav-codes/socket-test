/**
 * CallButton.tsx
 * Phone icon in the chat header. Clicking opens a user picker popover.
 * Disabled while a call is in progress.
 */
"use client";

import { useState, useRef, useEffect } from "react";
import { Phone, PhoneOff, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatUser } from "@/types/chat";
import type { CallStatus } from "@/types/call";

interface Props {
  users: ChatUser[];           // other users (self excluded by parent)
  callStatus: CallStatus;
  onCall: (targetSocketId: string, targetUsername: string) => void;
  onEndCall: () => void;
}

export default function CallButton({ users, callStatus, onCall, onEndCall }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Active call — show red hang-up button
  if (callStatus === "active" || callStatus === "calling") {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={onEndCall}
        className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 cursor-pointer animate-pulse"
        title="End call"
        aria-label="End call"
      >
        <PhoneOff className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => users.length > 0 && setOpen((v) => !v)}
        className={`h-8 w-8 cursor-pointer transition-colors ${
          users.length === 0
            ? "text-zinc-300 dark:text-zinc-600 cursor-not-allowed"
            : "text-zinc-500 hover:text-emerald-600 dark:hover:text-emerald-400"
        }`}
        title={users.length === 0 ? "No other users online" : "Start a voice call"}
        aria-label="Start a voice call"
        disabled={users.length === 0}
      >
        <Phone className="h-4 w-4" />
      </Button>

      {open && (
        <div className="absolute right-0 top-10 z-50 min-w-[160px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-1.5 flex flex-col gap-0.5">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider px-2 pt-1 pb-0.5">
            Call someone
          </p>
          {users.map((u) => (
            <button
              key={u.id}
              disabled={u.inCall}
              onClick={() => {
                onCall(u.id, u.username);
                setOpen(false);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-left transition-colors ${
                u.inCall
                  ? "opacity-50 cursor-not-allowed bg-zinc-50 dark:bg-zinc-800/50"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              }`}
            >
              <span className={`h-6 w-6 rounded-full text-white flex items-center justify-center text-[10px] font-bold shrink-0 ${
                u.inCall ? "bg-zinc-400 dark:bg-zinc-650" : "bg-emerald-500"
              }`}>
                {u.username[0].toUpperCase()}
              </span>
              <span className="truncate font-medium">{u.username}</span>
              {u.inCall ? (
                <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 ml-auto shrink-0 uppercase tracking-wider">Busy</span>
              ) : (
                <PhoneCall className="h-3 w-3 text-emerald-500 ml-auto shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

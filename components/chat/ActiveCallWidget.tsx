/**
 * ActiveCallWidget.tsx
 * Floating mini pill shown during an active voice call.
 * Default: compact pill with name + duration timer.
 * Hover / tap: expands to show Mute and End Call buttons.
 *
 * Also renders the hidden <audio> element for the remote stream.
 */
"use client";

import { useState, useEffect } from "react";
import { Mic, MicOff, PhoneOff } from "lucide-react";

interface Props {
  name: string;
  isMuted: boolean;
  onToggleMute: () => void;
  onEndCall: () => void;
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
}

function useCallTimer() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function ActiveCallWidget({ name, isMuted, onToggleMute, onEndCall, remoteAudioRef }: Props) {
  const [expanded, setExpanded] = useState(false);
  const duration = useCallTimer();

  return (
    <>
      {/* Hidden audio element — remote stream plays through here */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={remoteAudioRef} autoPlay style={{ display: "none" }} />

      <div
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        onFocus={() => setExpanded(true)}
        onBlur={() => setExpanded(false)}
        className={`
          fixed bottom-4 right-4 z-50
          bg-zinc-900 dark:bg-zinc-800
          border border-zinc-700 dark:border-zinc-600
          rounded-2xl shadow-2xl
          transition-all duration-300 ease-in-out
          overflow-hidden cursor-pointer
          ${expanded ? "w-64 p-4" : "w-48 p-3"}
        `}
        tabIndex={0}
        role="region"
        aria-label={`Active call with ${name}`}
      >
        {/* Always-visible top row */}
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Animated waveform bars */}
          <div className="flex items-end gap-[2px] h-5 shrink-0">
            {[0.4, 0.8, 0.5, 1, 0.6].map((h, i) => (
              <span
                key={i}
                className="w-[3px] rounded-full bg-emerald-400"
                style={{
                  height: `${h * 20}px`,
                  animation: `wave ${0.5 + i * 0.1}s ease-in-out ${i * 0.07}s infinite alternate`,
                }}
              />
            ))}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm truncate leading-tight">{name}</p>
            <p className="text-emerald-400 text-[11px] font-mono tabular-nums">{duration}</p>
          </div>

          {/* Quick end-call button always visible */}
          {!expanded && (
            <button
              onClick={(e) => { e.stopPropagation(); onEndCall(); }}
              className="h-7 w-7 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shrink-0 transition-colors"
              aria-label="End call"
            >
              <PhoneOff className="h-3.5 w-3.5 text-white" />
            </button>
          )}
        </div>

        {/* Expanded controls */}
        {expanded && (
          <div className="flex gap-2 mt-3 pt-3 border-t border-zinc-700">
            <button
              onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
                isMuted
                  ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30"
                  : "bg-zinc-700 text-zinc-200 hover:bg-zinc-600"
              }`}
              aria-label={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              {isMuted ? "Unmute" : "Mute"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onEndCall(); }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-colors"
              aria-label="End call"
            >
              <PhoneOff className="h-3.5 w-3.5" />
              End
            </button>
          </div>
        )}
      </div>

      {/* Keyframe for waveform bars */}
      <style>{`
        @keyframes wave {
          from { transform: scaleY(0.4); }
          to   { transform: scaleY(1); }
        }
      `}</style>
    </>
  );
}

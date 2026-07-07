"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useRef, useEffect } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  onTyping?: (isTyping: boolean) => void;
}

export default function ChatInput({ value, onChange, onSend, disabled, onTyping }: Props) {
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);

    if (onTyping) {
      if (!isTypingRef.current && val.trim().length > 0) {
        isTypingRef.current = true;
        onTyping(true);
      }

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

      typingTimeoutRef.current = setTimeout(() => {
        isTypingRef.current = false;
        onTyping(false);
      }, 1500);
    }
  };

  const handleSend = () => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    isTypingRef.current = false;
    if (onTyping) onTyping(false);
    onSend();
  };

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  return (
    <div className="flex gap-2 w-full">
      <Input
        placeholder="Type a message…"
        value={value}
        onChange={handleInputChange}
        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
        className="flex-1"
        disabled={disabled}
      />
      <Button onClick={handleSend} disabled={disabled}>
        Send
      </Button>
    </div>
  );
}

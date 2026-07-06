/**
 * ChatInput.tsx
 * Message input bar — purely presentational.
 */
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
}

export default function ChatInput({ value, onChange, onSend, disabled }: Props) {
  return (
    <div className="flex gap-2">
      <Input
        placeholder="Type a message…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && onSend()}
        className="flex-1"
        disabled={disabled}
      />
      <Button onClick={onSend} disabled={disabled}>
        Send
      </Button>
    </div>
  );
}

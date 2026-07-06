/**
 * JoinScreen.tsx
 * Name/nickname entry screen shown before entering the chat room.
 * Purely presentational — all logic lives in the parent.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onJoin: () => void;
}

export default function JoinScreen({ value, onChange, onJoin }: Props) {
  return (
    <div className="flex items-center justify-center min-h-screen p-4 bg-zinc-50 dark:bg-zinc-950">
      <Card className="w-full max-w-sm shadow-2xl border-zinc-200 dark:border-zinc-800">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Join Chat Room</CardTitle>
          <CardDescription>Enter your nickname to start messaging</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Your name (e.g., Alex)"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onJoin()}
            className="w-full text-center text-lg py-5 font-semibold"
            autoFocus
          />
        </CardContent>
        <CardFooter>
          <Button
            onClick={onJoin}
            className="w-full py-5 text-base font-semibold cursor-pointer"
            disabled={!value.trim()}
          >
            Enter Room
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

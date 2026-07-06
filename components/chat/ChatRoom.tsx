/**
 * ChatRoom.tsx
 * The main chat room shell. This is the only component with state — it delegates
 * everything to the useChat hook and wires the sub-components together.
 *
 * To embed in another project:
 *   <ChatRoom username="Alice" />
 */
"use client";

import { useChat } from "@/hooks/useChat";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import SoundToggle from "./SoundToggle";
import UserList from "./UserList";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";
import ToastNotification from "./ToastNotification";

interface Props {
  username: string;
}

export default function ChatRoom({ username }: Props) {
  const chat = useChat({ username });

  return (
    <div className="flex items-center justify-center min-h-screen p-4 bg-zinc-50 dark:bg-zinc-950">
      <Card className="w-full max-w-md shadow-xl border-zinc-200 dark:border-zinc-800 relative overflow-visible">
        {/* Header */}
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="space-y-0.5">
            <CardTitle className="text-xl font-bold">Chat Room</CardTitle>
            <CardDescription>
              Chatting as <span className="font-semibold text-zinc-700 dark:text-zinc-300">{username}</span>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <SoundToggle enabled={chat.soundEnabled} onToggle={chat.toggleSound} />
            <Badge variant={chat.isConnected ? "default" : "destructive"}>
              {chat.isConnected ? "Connected" : "Disconnected"}
            </Badge>
          </div>
        </CardHeader>

        {/* Body */}
        <CardContent className="pt-4 flex flex-col gap-3">
          <UserList users={chat.connectedUsers} socketId={chat.socketId} />
          <MessageList
            messages={chat.messages}
            username={username}
            messageRefs={chat.messageRefs}
          />
        </CardContent>

        {/* Footer */}
        <CardFooter>
          <ChatInput
            value={chat.input}
            onChange={chat.setInput}
            onSend={chat.sendMessage}
            disabled={!chat.isConnected}
          />
        </CardFooter>
      </Card>

      {/* Slide-in toast — clicking jumps to the message */}
      {chat.toast && (
        <ToastNotification
          toast={chat.toast}
          isVisible={chat.isToastVisible}
          onDismiss={chat.dismissToast}
          onMessageClick={chat.scrollToMessage}
        />
      )}
    </div>
  );
}

/**
 * ChatRoom.tsx
 * The main chat room shell. This component reads the persistent socket
 * and WebRTC calling states from the global ChatCallContext provider.
 */
"use client";

import { useChatCall } from "@/providers/ChatCallProvider";
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
import CallButton from "./CallButton";

interface Props {
  username: string;
}

export default function ChatRoom({ username }: Props) {
  const { chat, webrtc } = useChatCall();

  // If layout provider is not initialized yet, show loader or empty
  if (!chat || !webrtc) return null;

  // Filter out self from list of potential call recipients
  const otherUsers = chat.connectedUsers.filter((u) => u.id !== chat.socketId);

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
            <CallButton
              users={otherUsers}
              callStatus={webrtc.callStatus}
              onCall={webrtc.startCall}
              onEndCall={webrtc.endCall}
            />
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
    </div>
  );
}

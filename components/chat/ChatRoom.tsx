/**
 * ChatRoom.tsx
 * The main chat room shell. This component reads the persistent socket
 * and WebRTC calling states from the global ChatCallContext provider.
 *
 * It disconnects any active call when navigating away or refreshing,
 * and shows a manual Reconnect Prompt for 5 seconds upon return.
 */
"use client";

import { useEffect, useState } from "react";
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
import ReconnectToast from "./ReconnectToast";

interface Props {
  username: string;
}

export default function ChatRoom({ username }: Props) {
  const { chat, webrtc } = useChatCall();
  const [reconnectTarget, setReconnectTarget] = useState<string | null>(null);

  // Check if we just disconnected from a call under 5 seconds ago
  useEffect(() => {
    const savedUser = sessionStorage.getItem("last_call_username");
    const savedTime = sessionStorage.getItem("last_call_timestamp");
    if (savedUser && savedTime) {
      const elapsed = Date.now() - parseInt(savedTime, 10);
      if (elapsed < 5000) {
        setReconnectTarget(savedUser);
      } else {
        sessionStorage.removeItem("last_call_username");
        sessionStorage.removeItem("last_call_timestamp");
      }
    }
  }, []);

  // Handle page reload/refresh beforeunload: if a call is active/calling, save the target state
  useEffect(() => {
    if (!webrtc) return;
    const handleUnload = () => {
      if (webrtc.callStatus === "active" || webrtc.callStatus === "calling") {
        sessionStorage.setItem("last_call_username", webrtc.callTargetName);
        sessionStorage.setItem("last_call_timestamp", Date.now().toString());
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [webrtc]);

  // Handle component unmount (page navigation): if call is active/calling, save target and end call
  useEffect(() => {
    if (!webrtc) return;
    return () => {
      if (webrtc.callStatus === "active" || webrtc.callStatus === "calling") {
        sessionStorage.setItem("last_call_username", webrtc.callTargetName);
        sessionStorage.setItem("last_call_timestamp", Date.now().toString());
        webrtc.endCall();
      }
    };
  }, [webrtc]);

  // If layout provider is not initialized yet, show loader or empty
  if (!chat || !webrtc) return null;

  // Filter out self from list of potential call recipients
  const otherUsers = chat.connectedUsers.filter((u) => u.id !== chat.socketId);

  const handleReconnect = () => {
    if (!reconnectTarget) return;
    const targetUser = otherUsers.find((u) => u.username === reconnectTarget);
    if (targetUser) {
      webrtc.startCall(targetUser.id, targetUser.username);
    } else {
      alert(`${reconnectTarget} is offline.`);
    }
    handleDismissReconnect();
  };

  const handleDismissReconnect = () => {
    setReconnectTarget(null);
    sessionStorage.removeItem("last_call_username");
    sessionStorage.removeItem("last_call_timestamp");
  };

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

      {/* Manual Reconnect Prompt Toast (appears if user returned within 5s of disconnect) */}
      {reconnectTarget && (
        <ReconnectToast
          targetUsername={reconnectTarget}
          onReconnect={handleReconnect}
          onDismiss={handleDismissReconnect}
        />
      )}
    </div>
  );
}

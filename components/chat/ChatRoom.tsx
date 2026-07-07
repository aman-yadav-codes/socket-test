/**
 * ChatRoom.tsx
 * The main chat room shell. This component reads the persistent socket
 * and WebRTC calling states from the global ChatCallContext provider.
 *
 * It disconnects any active call when navigating away or refreshing,
 * and shows a manual Reconnect Prompt for 5 seconds upon return.
 */
"use client";

import { useEffect, useState, useRef } from "react";
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
  const webrtcRef = useRef(webrtc);
  const [reconnectTarget, setReconnectTarget] = useState<string | null>(null);
  const [callReason, setCallReason] = useState<string | null>(null);

  // Sync webrtc state ref to prevent stale closures and premature triggers in layout effects
  useEffect(() => {
    webrtcRef.current = webrtc;
  }, [webrtc]);

  const callStatus = webrtc?.callStatus;

  // Check if we just disconnected from a call under 5 seconds ago
  useEffect(() => {
    if (callStatus === "idle") {
      const savedUser = sessionStorage.getItem("last_call_username");
      const savedTime = sessionStorage.getItem("last_call_timestamp");
      const savedReason = sessionStorage.getItem("last_call_reason");
      if (savedUser && savedTime) {
        const elapsed = Date.now() - parseInt(savedTime, 10);
        if (elapsed < 5000) {
          setReconnectTarget(savedUser);
          setCallReason(savedReason);
        } else {
          sessionStorage.removeItem("last_call_username");
          sessionStorage.removeItem("last_call_timestamp");
          sessionStorage.removeItem("last_call_reason");
        }
      }
    }
  }, [callStatus]);

  // Handle page reload/refresh beforeunload: if a call is active/calling, save the target state
  useEffect(() => {
    const handleUnload = () => {
      const currentWebRTC = webrtcRef.current;
      if (currentWebRTC && (currentWebRTC.callStatus === "active" || currentWebRTC.callStatus === "calling")) {
        sessionStorage.setItem("last_call_username", currentWebRTC.callTargetName);
        sessionStorage.setItem("last_call_timestamp", Date.now().toString());
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  // Handle component unmount (page navigation): if call is active/calling, save target and end call
  useEffect(() => {
    return () => {
      const currentWebRTC = webrtcRef.current;
      if (currentWebRTC && (currentWebRTC.callStatus === "active" || currentWebRTC.callStatus === "calling")) {
        sessionStorage.setItem("last_call_username", currentWebRTC.callTargetName);
        sessionStorage.setItem("last_call_timestamp", Date.now().toString());
        currentWebRTC.endCall();
      }
    };
  }, []);

  // If layout provider is not initialized yet, show loader or empty
  if (!chat || !webrtc) return null;

  // Filter out self from list of potential call recipients
  const otherUsers = chat.connectedUsers.filter((u) => u.id !== chat.socketId);

  const ROOMS = ["general", "gaming", "random", "webrtc-dev"];

  const handleReconnect = () => {
    if (!reconnectTarget) return;
    const targetUser = otherUsers.find((u) => u.username === reconnectTarget);
    if (targetUser) {
      webrtc.startCall(targetUser.id, targetUser.username, "audio");
    } else {
      alert(`${reconnectTarget} is offline.`);
    }
    handleDismissReconnect();
  };

  const handleDismissReconnect = () => {
    setReconnectTarget(null);
    setCallReason(null);
    sessionStorage.removeItem("last_call_username");
    sessionStorage.removeItem("last_call_timestamp");
    sessionStorage.removeItem("last_call_reason");
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
              mode="audio"
            />
            <CallButton
              users={otherUsers}
              callStatus={webrtc.callStatus}
              onCall={webrtc.startCall}
              onEndCall={webrtc.endCall}
              mode="video"
            />
            <Badge variant={chat.isConnected ? "default" : "destructive"}>
              {chat.isConnected ? "Connected" : "Disconnected"}
            </Badge>
          </div>
        </CardHeader>

        {/* Body */}
        <CardContent className="pt-4 flex flex-col gap-3">
          {/* Room Selector */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none select-none">
            {ROOMS.map((r) => (
              <button
                key={r}
                onClick={() => chat.joinRoom(r)}
                className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all cursor-pointer ${
                  chat.room === r
                    ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
                    : "bg-transparent text-zinc-500 border-zinc-200 hover:text-zinc-900 hover:border-zinc-400 dark:border-zinc-800 dark:hover:text-zinc-100 dark:hover:border-zinc-600"
                }`}
              >
                #{r}
              </button>
            ))}
          </div>

          <UserList users={chat.connectedUsers} socketId={chat.socketId} />
          <MessageList
            messages={chat.messages}
            username={username}
            messageRefs={chat.messageRefs}
          />
        </CardContent>

        {/* Footer */}
        <CardFooter className="flex flex-col items-start gap-1">
          {/* Typing Indicator */}
          <div className="h-4 w-full flex items-center px-1">
            {chat.typingUsers.length > 0 && (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500 italic animate-pulse">
                {chat.typingUsers.join(", ")} {chat.typingUsers.length === 1 ? "is" : "are"} typing...
              </span>
            )}
          </div>
          <ChatInput
            value={chat.input}
            onChange={chat.setInput}
            onSend={chat.sendMessage}
            disabled={!chat.isConnected}
            onTyping={chat.sendTypingStatus}
          />
        </CardFooter>
      </Card>

      {/* Manual Reconnect Prompt Toast (appears if user returned within 5s of disconnect or call timed out) */}
      {reconnectTarget && (
        <ReconnectToast
          targetUsername={reconnectTarget}
          isOnline={!!otherUsers.find((u) => u.username === reconnectTarget)}
          onReconnect={handleReconnect}
          onDismiss={handleDismissReconnect}
          title={callReason === "no_answer" ? "No Answer" : "Call Disconnected"}
          message={callReason === "no_answer" ? `${reconnectTarget} hasn't picked up the call. Wanna reconnect?` : undefined}
        />
      )}
    </div>
  );
}

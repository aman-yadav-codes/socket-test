/**
 * GlobalCallOverlays.tsx
 * Renders call widgets, notifications, and toasts globally at the root layout level.
 * This guarantees calling overlays persist during routing and are always active.
 */
"use client";

import { useChatCall } from "@/providers/ChatCallProvider";
import ToastNotification from "./ToastNotification";
import IncomingCallToast from "./IncomingCallToast";
import OutgoingCallIndicator from "./OutgoingCallIndicator";
import ActiveCallWidget from "./ActiveCallWidget";

export default function GlobalCallOverlays() {
  const { chat, webrtc } = useChatCall();

  if (!chat || !webrtc) return null;

  return (
    <>
      {/* Unconditionally mount the audio element so browsers pull WebRTC remote audio frames from the network */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={webrtc.remoteAudioRef} autoPlay className="hidden" />

      {/* Slide-in toast — clicking jumps to the message */}
      {chat.toast && (
        <ToastNotification
          toast={chat.toast}
          isVisible={chat.isToastVisible}
          onDismiss={chat.dismissToast}
          onMessageClick={chat.scrollToMessage}
        />
      )}

      {/* WebRTC Calling UI components */}
      {webrtc.callStatus === "ringing" && webrtc.incomingCall && (
        <IncomingCallToast
          callerName={webrtc.incomingCall.fromUsername}
          onAccept={webrtc.acceptCall}
          onReject={webrtc.rejectCall}
        />
      )}

      {webrtc.callStatus === "calling" && (
        <OutgoingCallIndicator
          name={webrtc.callTargetName}
          onCancel={webrtc.endCall}
        />
      )}

      {webrtc.callStatus === "active" && (
        <ActiveCallWidget
          name={webrtc.callTargetName}
          isMuted={webrtc.isMuted}
          onToggleMute={webrtc.toggleMute}
          onEndCall={webrtc.endCall}
          remoteAudioRef={webrtc.remoteAudioRef}
          micGain={webrtc.micGain}
          onMicGainChange={webrtc.setMicGain}
          speakerVolume={webrtc.speakerVolume}
          onSpeakerVolumeChange={webrtc.setSpeakerVolume}
        />
      )}
    </>
  );
}

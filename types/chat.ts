// Shared types for the chat module.
// Import these in any component, hook, or server file that deals with chat data.

export interface ChatUser {
  id: string;
  username: string;
  inCall?: boolean;
}

export interface ChatMessage {
  /** Unique server-assigned ID. Optimistic messages use `optimistic-<timestamp>`. */
  id: string;
  text: string;
  sender: string;
  timestamp: string;
  room?: string;
  status?: "sent" | "delivered" | "read";
  type?: "text" | "call";
  callDetails?: {
    caller: string;
    receiver: string;
    status: "answered" | "missed" | "declined";
    duration?: string;
  };
}

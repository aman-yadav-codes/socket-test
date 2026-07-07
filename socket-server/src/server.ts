import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import Redis from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";

dotenv.config();

const PORT = parseInt(process.env.PORT || "3001", 10);
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-jwt-key-change-me-in-production";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const REDIS_URL = process.env.REDIS_URL;

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const httpServer = createServer(app);

// Initialize Redis if configured
let redisPub: Redis | null = null;
let redisSub: Redis | null = null;
let redisClient: Redis | null = null;
let isRedisEnabled = false;

if (REDIS_URL) {
  try {
    console.log(`Connecting to Redis at: ${REDIS_URL}`);
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true
    });

    redisPub = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    redisSub = redisPub.duplicate();

    redisClient.on("connect", () => {
      console.log("Redis main client connected successfully.");
      isRedisEnabled = true;
    });

    redisClient.on("error", (err) => {
      console.error("Redis client error:", err.message);
      isRedisEnabled = false;
    });

    redisPub.on("error", (err) => console.error("Redis Pub error:", err.message));
    redisSub.on("error", (err) => console.error("Redis Sub error:", err.message));
  } catch (err) {
    console.error("Failed to initialize Redis clients:", err);
  }
} else {
  console.log("No REDIS_URL provided. Operating in in-memory fallback mode.");
}

// REST Route to login and get JWT token
app.post("/api/auth/login", (req, res) => {
  const { username } = req.body;
  if (!username || typeof username !== "string" || !username.trim()) {
    return res.status(400).json({ error: "Username is required" });
  }
  const cleanUsername = username.trim();
  const token = jwt.sign({ username: cleanUsername }, JWT_SECRET, { expiresIn: "24h" });
  console.log(`[auth] Signed token for username: ${cleanUsername}`);
  return res.json({ token, username: cleanUsername });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    redis: isRedisEnabled ? "connected" : "fallback-in-memory",
    clientsCount: io.engine.clientsCount
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    redis: isRedisEnabled ? "connected" : "fallback-in-memory",
    clientsCount: io.engine.clientsCount
  });
});

// Configure Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Attach Redis Adapter for horizontal scaling if Redis is configured
if (REDIS_URL && redisPub && redisSub) {
  io.adapter(createAdapter(redisPub, redisSub));
  console.log("Socket.IO Redis adapter attached.");
}

// --- In-memory fallback stores ---
const fallbackActiveSockets = new Map<string, string>(); // socketId -> username
const fallbackUserSockets = new Map<string, Set<string>>(); // username -> Set of socketIds
const fallbackRoomMessages = new Map<string, any[]>(); // roomName -> messageArray
const fallbackRoomUsers = new Map<string, Set<string>>(); // roomName -> Set of usernames

const inCallSockets = new Set<string>(); // Set of socketIds currently in a call

async function markInCall(socketId1: string, socketId2: string, inCall: boolean) {
  if (inCall) {
    inCallSockets.add(socketId1);
    inCallSockets.add(socketId2);
    if (isRedisEnabled && redisClient && redisClient.status === "ready") {
      try {
        await redisClient.sadd("presence:in_call_sockets", socketId1, socketId2);
      } catch (e) {
        console.error("Redis sadd inCallSockets error:", e);
      }
    }
  } else {
    inCallSockets.delete(socketId1);
    inCallSockets.delete(socketId2);
    if (isRedisEnabled && redisClient && redisClient.status === "ready") {
      try {
        await redisClient.srem("presence:in_call_sockets", socketId1, socketId2);
      } catch (e) {
        console.error("Redis srem inCallSockets error:", e);
      }
    }
  }
}

// Helper: Add socket presence
async function addPresence(socketId: string, username: string) {
  // Always update local store
  fallbackActiveSockets.set(socketId, username);
  if (!fallbackUserSockets.has(username)) {
    fallbackUserSockets.set(username, new Set());
  }
  fallbackUserSockets.get(username)!.add(socketId);

  if (isRedisEnabled && redisClient && redisClient.status === "ready") {
    try {
      await redisClient.hset("presence:sockets", socketId, username);
      await redisClient.sadd(`presence:user_sockets:${username}`, socketId);
    } catch (e) {
      console.error("Redis addPresence error:", e);
    }
  }
}

// Helper: Remove socket presence
async function removePresence(socketId: string, username: string) {
  // Always update local store
  fallbackActiveSockets.delete(socketId);
  inCallSockets.delete(socketId);
  const sockets = fallbackUserSockets.get(username);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) {
      fallbackUserSockets.delete(username);
    }
  }

  if (isRedisEnabled && redisClient && redisClient.status === "ready") {
    try {
      await redisClient.hdel("presence:sockets", socketId);
      await redisClient.srem(`presence:user_sockets:${username}`, socketId);
      await redisClient.srem("presence:in_call_sockets", socketId);
    } catch (e) {
      console.error("Redis removePresence error:", e);
    }
  }
}

// Helper: Get users list (across all connected sockets)
async function getUsersList(): Promise<Array<{ id: string; username: string; inCall?: boolean }>> {
  let list: Array<{ id: string; username: string }> = [];
  let redisInCallSet = new Set<string>();

  if (isRedisEnabled && redisClient && redisClient.status === "ready") {
    try {
      const data = await redisClient.hgetall("presence:sockets");
      if (Object.keys(data).length > 0) {
        list = Object.entries(data).map(([socketId, username]) => ({
          id: socketId,
          username
        }));
        const inCallData = await redisClient.smembers("presence:in_call_sockets");
        redisInCallSet = new Set(inCallData);
      }
    } catch (e) {
      console.error("Redis getUsersList error. Falling back to local store:", e);
    }
  }

  if (list.length === 0) {
    // Failover to local memory store
    list = Array.from(fallbackActiveSockets.entries()).map(([id, username]) => ({
      id,
      username
    }));
  }

  // Attach inCall status
  return list.map((user) => ({
    ...user,
    inCall: redisInCallSet.size > 0 ? redisInCallSet.has(user.id) : inCallSockets.has(user.id)
  }));
}

// Helper: Store and get chat messages
async function persistMessage(room: string, message: any) {
  // Always update local store
  if (!fallbackRoomMessages.has(room)) {
    fallbackRoomMessages.set(room, []);
  }
  const msgs = fallbackRoomMessages.get(room)!;
  msgs.push(message);
  if (msgs.length > 200) {
    msgs.splice(0, msgs.length - 200);
  }

  if (isRedisEnabled && redisClient && redisClient.status === "ready") {
    try {
      const key = `chat:messages:${room}`;
      await redisClient.rpush(key, JSON.stringify(message));
      await redisClient.ltrim(key, -200, -1);
    } catch (e) {
      console.error("Redis persistMessage error:", e);
    }
  }
}

async function getMessageHistory(room: string): Promise<any[]> {
  if (isRedisEnabled && redisClient && redisClient.status === "ready") {
    try {
      const key = `chat:messages:${room}`;
      const data = await redisClient.lrange(key, 0, -1);
      if (data && data.length > 0) {
        return data.map((item) => JSON.parse(item));
      }
    } catch (e) {
      console.error("Redis getMessageHistory error. Falling back to local store:", e);
    }
  }

  // Failover to local memory store
  return fallbackRoomMessages.get(room) || [];
}

// Socket JWT authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  if (!token) {
    console.log(`[auth] Rejected connection for socket ${socket.id}: Token missing`);
    return next(new Error("Authentication error: Token missing"));
  }

  try {
    const decoded = jwt.verify(token as string, JWT_SECRET) as { username: string };
    if (!decoded.username) {
      return next(new Error("Authentication error: Invalid payload"));
    }
    socket.data.username = decoded.username;
    next();
  } catch (err) {
    console.log(`[auth] Rejected connection for socket ${socket.id}: Invalid token`);
    return next(new Error("Authentication error: Invalid or expired token"));
  }
});

// Connection handler
io.on("connection", async (socket: Socket) => {
  const username = socket.data.username as string;
  console.log(`[socket] User connected: ${username} (Socket: ${socket.id})`);

  // Add presence
  await addPresence(socket.id, username);

  // Join the default general room
  const defaultRoom = "general";
  socket.join(defaultRoom);
  socket.data.room = defaultRoom;

  // Send message history of general room
  const history = await getMessageHistory(defaultRoom);
  socket.emit("message-history", history);

  // Broadcast updated user list to everyone
  const users = await getUsersList();
  io.emit("users-update", users);

  // Handle client requesting users list manually
  socket.on("get-users", async () => {
    const list = await getUsersList();
    socket.emit("users-update", list);
  });

  // Handle joining a room
  socket.on("join-room", async (roomName: string) => {
    if (!roomName || typeof roomName !== "string" || !roomName.trim()) return;
    const cleanRoom = roomName.trim();

    // Leave current room
    const currentRoom = socket.data.room;
    if (currentRoom) {
      socket.leave(currentRoom);
      // Emit stop typing in previous room
      socket.to(currentRoom).emit("typing-update", { username, isTyping: false, room: currentRoom });
    }

    // Join new room
    socket.join(cleanRoom);
    socket.data.room = cleanRoom;
    console.log(`[room] Socket ${socket.id} (${username}) joined room: ${cleanRoom}`);

    // Send history of new room
    const roomHistory = await getMessageHistory(cleanRoom);
    socket.emit("message-history", roomHistory);

    // Notify room of join (system notification)
    const systemMsg = {
      id: `sys-${Date.now()}`,
      text: `${username} has joined the room.`,
      sender: "System",
      timestamp: new Date().toISOString(),
      room: cleanRoom,
      isSystem: true
    };
    socket.to(cleanRoom).emit("receive-message", systemMsg);
  });

  // Handle messages
  socket.on("send-message", async (text: string) => {
    if (typeof text !== "string" || !text.trim()) return;
    const room = socket.data.room || "general";

    const messageEntry = {
      id: `${socket.id}-${Date.now()}`,
      text: text.trim(),
      sender: username,
      timestamp: new Date().toISOString(),
      room: room,
      status: "sent"
    };

    // Save in Redis/fallback
    await persistMessage(room, messageEntry);

    // Broadcast to room
    io.to(room).emit("receive-message", messageEntry);
  });

  // Handle call logging
  socket.on("log-call", async ({ room, callDetails }: { room: string; callDetails: any }) => {
    const cleanRoom = room || socket.data.room || "general";
    const messageEntry = {
      id: `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      text: `${callDetails.caller} called ${callDetails.receiver} (${callDetails.status === "answered" ? callDetails.duration : callDetails.status})`,
      sender: "System",
      timestamp: new Date().toISOString(),
      room: cleanRoom,
      type: "call",
      callDetails
    };

    await persistMessage(cleanRoom, messageEntry);
    io.to(cleanRoom).emit("receive-message", messageEntry);
  });

  // Handle typing indicators
  socket.on("typing", (isTyping: boolean) => {
    const room = socket.data.room || "general";
    socket.to(room).emit("typing-update", {
      username,
      isTyping,
      room
    });
  });

  // Handle delivery and read receipts
  socket.on("message-delivered", ({ messageId, senderName, room }: { messageId: string; senderName: string; room: string }) => {
    // Relay receipt to sender
    // We can broadcast it to the room or to the sender's specific sockets
    socket.to(room).emit("message-status-update", {
      messageId,
      status: "delivered",
      room
    });
  });

  socket.on("message-read", ({ messageId, senderName, room }: { messageId: string; senderName: string; room: string }) => {
    // Relay receipt to sender
    socket.to(room).emit("message-status-update", {
      messageId,
      status: "read",
      room
    });
  });

  // --- WebRTC signaling relay (server is a dumb pipe) ---
  socket.on("call-user", ({ to, offer, isReconnect }) => {
    io.to(to).emit("incoming-call", {
      from: socket.id,
      fromUsername: username,
      offer,
      isReconnect
    });
  });

  socket.on("call-answer", async ({ to, answer }) => {
    await markInCall(socket.id, to, true);
    const users = await getUsersList();
    io.emit("users-update", users);

    io.to(to).emit("call-answered", {
      from: socket.id,
      answer
    });
  });

  socket.on("call-rejected", ({ to }) => {
    io.to(to).emit("call-rejected", {
      from: socket.id
    });
  });

  socket.on("call-ended", async ({ to }) => {
    await markInCall(socket.id, to, false);
    const users = await getUsersList();
    io.emit("users-update", users);

    io.to(to).emit("call-ended", {
      from: socket.id
    });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("ice-candidate", {
      from: socket.id,
      candidate
    });
  });

  socket.on("mic-gain-change", ({ to, gain }) => {
    io.to(to).emit("mic-gain-change", {
      gain
    });
  });

  // Disconnect handler
  socket.on("disconnect", async () => {
    console.log(`[socket] User disconnected: ${username} (Socket: ${socket.id})`);
    
    // Remove presence
    await removePresence(socket.id, username);

    // Notify current room of typing stop
    const room = socket.data.room;
    if (room) {
      socket.to(room).emit("typing-update", { username, isTyping: false, room });
    }

    // Broadcast updated user list
    const updatedUsers = await getUsersList();
    io.emit("users-update", updatedUsers);
  });
});

httpServer.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`Dedicated Socket.IO Server running on port ${PORT}`);
  console.log(`JWT Authentication enabled.`);
  console.log(`WebRTC Signaling support active.`);
  console.log(`========================================`);
});

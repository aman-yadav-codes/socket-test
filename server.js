const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3001", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server({
    path: "/api/socket",
    addTrailingSlash: false,
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.attach(server);
  server.io = io;

  // Intercept upgrade events to prevent Next.js from closing Socket.io WebSocket upgrades
  const originalEmit = server.emit;
  server.emit = function (event, req, socket, head) {
    if (event === "upgrade" && req.url && req.url.startsWith("/api/socket")) {
      io.engine.handleUpgrade(req, socket, head);
      return true;
    }
    return originalEmit.apply(this, arguments);
  };

  // --- In-memory stores (swap these for a DB adapter later) ---
  const activeUsers = global.activeUsers instanceof Map
    ? global.activeUsers
    : new Map();
  global.activeUsers = activeUsers;

  // Each stored entry: { id, text, sender, timestamp }
  const messages = Array.isArray(global.messages) ? global.messages : [];
  // Backfill id for any stale entries that pre-date the id field (prevents React key warnings)
  messages.forEach((m, i) => { if (!m.id) m.id = `legacy-${i}`; });
  global.messages = messages;
  // ------------------------------------------------------------

  const getUsersList = () =>
    Array.from(activeUsers.entries()).map(([id, name]) => ({ id, username: name }));

  io.on("connection", (socket) => {
    const username = socket.handshake.query.username || "Guest";
    console.log("New client connected:", socket.id, "as", username);
    activeUsers.set(socket.id, username);

    // Send full message history only to the newly connected client
    socket.emit("message-history", messages);

    // Broadcast updated user list to all clients
    io.emit("users-update", getUsersList());

    socket.on("get-users", () => {
      socket.emit("users-update", getUsersList());
    });

    socket.on("send-message", (text) => {
      // Validate: must be a non-empty string
      if (typeof text !== "string" || !text.trim()) return;

      const entry = {
        id: `${socket.id}-${Date.now()}`, // unique per-message ID (used for dedup on client)
        text: text.trim(),
        sender: username,
        timestamp: new Date().toISOString(),
      };

      // Persist in memory
      messages.push(entry);
      // Cap at 200 to avoid unbounded growth
      if (messages.length > 200) messages.splice(0, messages.length - 200);

      console.log(`[msg] ${username}: ${entry.text}`);

      // Emit to ALL clients so sender also gets the canonical copy
      io.emit("receive-message", entry);
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id, "as", username);
      activeUsers.delete(socket.id);
      io.emit("users-update", getUsersList());
    });

    // ── WebRTC signaling relay (server is a dumb pipe) ──────────────────────
    socket.on("call-user",      ({ to, offer, isReconnect }) => io.to(to).emit("incoming-call",  { from: socket.id, fromUsername: username, offer, isReconnect }));
    socket.on("call-answer",    ({ to, answer })             => io.to(to).emit("call-answered",  { from: socket.id, answer }));
    socket.on("call-rejected",  ({ to })            => io.to(to).emit("call-rejected",  { from: socket.id }));
    socket.on("call-ended",     ({ to })            => io.to(to).emit("call-ended",     { from: socket.id }));
    socket.on("ice-candidate",  ({ to, candidate }) => io.to(to).emit("ice-candidate",  { from: socket.id, candidate }));
    socket.on("mic-gain-change", ({ to, gain })      => io.to(to).emit("mic-gain-change", { gain }));
    // ────────────────────────────────────────────────────────────────────────
  });

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});

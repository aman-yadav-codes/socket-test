import { Server as NetServer } from "http";
import { NextApiRequest, NextApiResponse } from "next";
import { Server as ServerIO } from "socket.io";
import { Socket } from "net";

export type NextApiResponseServerIO = NextApiResponse & {
  socket: Socket & {
    server: NetServer & {
      io: ServerIO;
    };
  };
};

export const config = {
  api: {
    bodyParser: false,
  },
};

// Persist activeUsers map in global namespace to survive Next.js HMR compilation reloads
const globalActiveUsers: Map<string, string> = (global as any).activeUsers instanceof Map
  ? (global as any).activeUsers
  : new Map<string, string>();
(global as any).activeUsers = globalActiveUsers;

const ioHandler = (req: NextApiRequest, res: NextApiResponseServerIO) => {
  if (!res.socket.server.io) {
    console.log("*First use, starting socket.io");
    const httpServer: NetServer = res.socket.server;
    const io = new ServerIO(httpServer, {
      path: "/api/socket",
      addTrailingSlash: false,
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    res.socket.server.io = io;

    io.on("connection", (socket) => {
      const username = (socket.handshake.query.username as string) || "Guest";
      console.log("New client connected:", socket.id, "as", username);
      globalActiveUsers.set(socket.id, username);

      const getUsersList = () => {
        const list: Array<{ id: string; username: string }> = [];
        globalActiveUsers.forEach((name, id) => {
          list.push({ id, username: name });
        });
        return list;
      };

      // Broadcast list of active users to all clients
      io.emit("users-update", getUsersList());

      socket.on("get-users", () => {
        socket.emit("users-update", getUsersList());
      });

      socket.on("send-message", (msg) => {
        console.log(`Server received message from ${username}:`, msg);
        socket.broadcast.emit("receive-message", { text: msg, sender: username });
      });

      // ── WebRTC signaling relay ──────────────────────────────────────────────
      socket.on("call-user", ({ to, offer }) => {
        io.to(to).emit("incoming-call", { from: socket.id, fromUsername: username, offer });
      });
      socket.on("call-answer", ({ to, answer }) => {
        io.to(to).emit("call-answered", { from: socket.id, answer });
      });
      socket.on("call-rejected", ({ to }) => {
        io.to(to).emit("call-rejected", { from: socket.id });
      });
      socket.on("call-ended", ({ to }) => {
        io.to(to).emit("call-ended", { from: socket.id });
      });
      socket.on("ice-candidate", ({ to, candidate }) => {
        io.to(to).emit("ice-candidate", { from: socket.id, candidate });
      });
      socket.on("mic-gain-change", ({ to, gain }) => {
        io.to(to).emit("mic-gain-change", { gain });
      });
      // ────────────────────────────────────────────────────────────────────────

      socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id, "as", username);
        globalActiveUsers.delete(socket.id);
        io.emit("users-update", getUsersList());
      });
    });
  }
  res.end();
};

export default ioHandler;

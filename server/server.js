const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Odaları saklamak için bir Map
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Oda oluşturma
  socket.on("create-room", () => {
    const roomId = Math.random().toString(36).substring(2, 8);
    rooms.set(roomId, { users: new Set([socket.id]) });
    socket.join(roomId);
    socket.emit("room-created", roomId);
    console.log(`Room created: ${roomId}`);
  });

  // Odaya katılma
  socket.on("join-room", (roomId) => {
    if (rooms.has(roomId)) {
      socket.join(roomId);
      rooms.get(roomId).users.add(socket.id);
      io.to(roomId).emit("user-joined", socket.id);
      console.log(`User ${socket.id} joined room ${roomId}`);
    } else {
      socket.emit("error", "Room not found");
    }
  });

  // Ses verisi iletimi
  socket.on("voice", (data) => {
    const roomIds = Array.from(socket.rooms);
    roomIds.forEach((roomId) => {
      if (roomId !== socket.id) {
        // socket.id'yi hariç tut
        socket.to(roomId).emit("voice", data);
      }
    });
  });

  // Bağlantı koptuğunda
  socket.on("disconnect", () => {
    rooms.forEach((room, roomId) => {
      if (room.users.has(socket.id)) {
        room.users.delete(socket.id);
        if (room.users.size === 0) {
          rooms.delete(roomId);
        }
      }
    });
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

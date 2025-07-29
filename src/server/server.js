const exprconst httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  },
});

// Serve static files from the React app
app.use(express.static(path.join(__dirname, "../client/build")));

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/build/index.html"));
});quire("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
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
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

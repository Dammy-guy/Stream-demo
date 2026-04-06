import express from "express";
import http from "http";
import { Server } from "socket.io";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const __dirname = dirname(fileURLToPath(import.meta.url));

// Exposing public directory to outside world
app.use(express.static("public"));

// Handle incoming http request
app.get("/", (req, res) => {
    res.sendFile(join(__dirname, "app", "index.html"));
});

io.on("connection", (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on("join-room", ({ roomId }) => {
        socket.join(roomId);
        socket.roomId = roomId; // Save for disconnect handling
        
        // Get list of clients dynamically from the room adapter
        const roomClients = io.sockets.adapter.rooms.get(roomId);
        const clientsArray = roomClients ? Array.from(roomClients) : [];
        
        // Send the existing users in this exact room to the new user
        socket.emit("update-user-list", { users: clientsArray.filter(id => id !== socket.id) });
        
        // Broadcast specifically to this room that a new user joined
        socket.to(roomId).emit("update-user-list", { users: [socket.id] });
    });

    // Handle disconnecting
    socket.on("disconnect", () => {
        console.log('User disconnected:', socket.id);
        if (socket.roomId) {
            socket.to(socket.roomId).emit("remove-user", { socketId: socket.id });
        }
    });

    // Ringing State Signaling
    socket.on("call-request", data => {
        socket.to(data.to).emit("call-request", {
            callerId: socket.id,
            callerName: data.callerName
        });
    });

    socket.on("call-accepted", data => {
        socket.to(data.to).emit("call-accepted", {
            answererId: socket.id
        });
    });

    socket.on("call-declined", data => {
        socket.to(data.to).emit("call-declined", {
            answererId: socket.id
        });
    });

    socket.on("end-call", data => {
        socket.to(data.to).emit("call-ended");
    });

    // WebRTC Signaling: relaying the offer
    socket.on("call-user", data => {
        socket.to(data.to).emit("call-made", {
            offer: data.offer,
            socket: socket.id
        });
    });

    // WebRTC Signaling: relaying the answer
    socket.on("make-answer", data => {
        socket.to(data.to).emit("answer-made", {
            socket: socket.id,
            answer: data.answer
        });
    });

    // WebRTC Signaling: relaying ICE candidates
    socket.on("ice-candidate", data => {
        socket.to(data.to).emit("ice-candidate-received", {
            socket: socket.id,
            candidate: data.candidate
        });
    });
});

server.listen(9000, () => {
    console.log("Server reliably running on HTTP port 9000");
    console.log("👉 Please access via: http://localhost:9000 (Local testing)");
});
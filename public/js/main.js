const socket = io();

// Theme Toggle Logic
const toggleSwitch = document.querySelector('.theme-switch input[type="checkbox"]');
const currentTheme = localStorage.getItem('theme');

if (currentTheme) {
    document.documentElement.setAttribute('data-theme', currentTheme);
    if (currentTheme === 'light') toggleSwitch.checked = true;
}

toggleSwitch.addEventListener('change', function(e) {
    if (e.target.checked) {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
    } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }    
});

// URL parsing for Room ID
const urlParams = new URLSearchParams(window.location.search);
let roomId = urlParams.get('room');

if (!roomId) {
    roomId = Math.random().toString(36).substring(2, 8);
    window.history.replaceState(null, '', `?room=${roomId}`);
}

// Immediately join the room
socket.emit('join-room', { roomId });

// Handle Invite Button
const btnInvite = document.getElementById('btn-invite');
if (btnInvite) {
    btnInvite.addEventListener('click', () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
            const originalText = btnInvite.innerHTML;
            btnInvite.innerHTML = '<i class="ph-bold ph-check"></i><span>Copied!</span>';
            setTimeout(() => {
                btnInvite.innerHTML = originalText;
            }, 2000);
        }).catch(err => console.error('Failed to copy: ', err));
    });
}

// WebRTC State Configuration
const { RTCPeerConnection, RTCSessionDescription } = window;
let localStream = null;
let peerConnection = null; // Single RTCPeerConnection for 1-to-1 call

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// UI Elements
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const videoGrid = document.getElementById('video-grid');
const userList = document.getElementById('allusers');

const btnMic = document.getElementById('btn-mic');
const btnVideo = document.getElementById('btn-video');
const btnScreen = document.getElementById('btn-screen');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnEnd = document.getElementById('btn-end');

const modal = document.getElementById('incoming-call-modal');
const callerNameSpan = document.getElementById('caller-name-span');
const btnAccept = document.getElementById('btn-accept');
const btnDecline = document.getElementById('btn-decline');

// ===================================
// Premium Audio Engine (Remote Hosted)
// ===================================
const ringAudio = new Audio('https://www.soundjay.com/phone/telephone-ring-04a.mp3');
ringAudio.loop = true;
const clickAudio = new Audio('https://www.soundjay.com/buttons/button-29.mp3'); // Crisp interface click

const playClick = () => { clickAudio.currentTime = 0; clickAudio.play().catch(e=>{}); };
const playRing = () => { ringAudio.play().catch(e=>{}); };
const stopRing = () => { ringAudio.pause(); ringAudio.currentTime = 0; };

// Media Setup: Turn Camera on immediately
async function setupLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (error) {
        console.error('Error accessing media devices.', error);
        alert('Could not access Camera or Microphone. Note: If testing on a phone over WiFi, standard HTTP requires an external secure tunnel (like ngrok) or localhost to work!');
    }
}
setupLocalStream();

// UI Controls logic mapped to actual media tracks
let isMicMuted = false;
let isVideoOff = false;

btnMic.addEventListener('click', () => {
    if (!localStream) return;
    playClick();
    isMicMuted = !isMicMuted;
    localStream.getAudioTracks()[0].enabled = !isMicMuted;

    if (isMicMuted) {
        btnMic.classList.add('muted');
        btnMic.innerHTML = '<i class="ph-fill ph-microphone-slash"></i>';
    } else {
        btnMic.classList.remove('muted');
        btnMic.innerHTML = '<i class="ph-fill ph-microphone"></i>';
    }
});

btnVideo.addEventListener('click', () => {
    if (!localStream) return;
    playClick();
    isVideoOff = !isVideoOff;
    localStream.getVideoTracks()[0].enabled = !isVideoOff;

    if (isVideoOff) {
        btnVideo.classList.add('muted');
        btnVideo.innerHTML = '<i class="ph-fill ph-video-camera-slash"></i>';
    } else {
        btnVideo.classList.remove('muted');
        btnVideo.innerHTML = '<i class="ph-fill ph-video-camera"></i>';
    }
});

// Screen Share Logic
let screenStream = null;

btnScreen.addEventListener('click', async () => {
    playClick();
    // 1. Toggle Off Screen Share
    if (screenStream) {
        stopScreenShare();
        return;
    }

    // 2. Toggle On Screen Share
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        
        // Listen for native OS dialog "Stop Sharing" button
        screenTrack.onended = () => {
            stopScreenShare();
        };

        // Hot-swap outgoing WebRTC video track smoothly without dropping call
        if (peerConnection) {
            const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
            if (sender) sender.replaceTrack(screenTrack);
        }

        // Output screen locally instead of face
        localVideo.style.transform = 'none';
        localVideo.srcObject = screenStream;

        // UI styling updates
        btnScreen.classList.add('active');
        btnScreen.innerHTML = '<i class="ph-fill ph-screencast"></i>';
    } catch (err) {
        console.error('Failed to pick screen:', err);
    }
});

function stopScreenShare() {
    if (!screenStream) return;
    
    // Kill the screen broadcast tracks
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;

    // Bring original camera back online and swap it into the active call
    const cameraTrack = localStream.getVideoTracks()[0];
    if (peerConnection) {
        const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
        if (sender) sender.replaceTrack(cameraTrack);
    }
    
    // Switch local PIP monitor back to face
    localVideo.style.transform = 'none';
    localVideo.srcObject = localStream;

    // Revert UI button
    btnScreen.classList.remove('active');
    btnScreen.innerHTML = '<i class="ph-bold ph-screencast"></i>';
}

// Fullscreen Logic
const remoteWrapper = document.getElementById('remote-wrapper');
btnFullscreen.addEventListener('click', () => {
    playClick();
    if (!document.fullscreenElement) {
        remoteWrapper.requestFullscreen().catch(err => console.error(err));
        btnFullscreen.innerHTML = '<i class="ph-bold ph-corners-in"></i>';
    } else {
        document.exitFullscreen();
        btnFullscreen.innerHTML = '<i class="ph-bold ph-corners-out"></i>';
    }
});

// Socket Event Tracking (Online Users Update)
let onlineUsers = [];

const cuteNames = [
    "Fluffy Bunny", "Sleepy Panda", "Happy Quokka", 
    "Silly Goose", "Brave Lion", "Tiny Turtle", 
    "Clever Fox", "Dancing Penguin", "Jumpy Frog", 
    "Cheeky Monkey", "Cozy Bear", "Fuzzy Kitty",
    "Sparkly Unicorn", "Wobbly Jellyfish", "Bouncy Tiger"
];

function getCuteName(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % cuteNames.length;
    return cuteNames[index];
}

// Automatically update local UI identity
socket.on('connect', updateLocalInfo);
if (socket.id) updateLocalInfo(); // Failsafe if already connected

function updateLocalInfo() {
    const cuteName = getCuteName(socket.id);
    const localUserName = document.getElementById('local-user-name');
    const localAvatar = document.getElementById('local-avatar');
    if (localUserName) localUserName.innerText = `${cuteName} (You)`;
    if (localAvatar) localAvatar.innerText = cuteName.substring(0, 1);
}

function renderUserList() {
    const children = Array.from(userList.children);
    children.forEach(child => {
        if (!child.classList.contains('active-user')) userList.removeChild(child);
    });

    onlineUsers.forEach(userId => {
        const cuteName = getCuteName(userId);
        const li = document.createElement('li');
        li.className = 'contact-item';
        li.innerHTML = `
            <div class="avatar-container">
                <div class="avatar">${cuteName.substring(0, 1)}</div>
                <span class="status online"></span>
            </div>
            <span class="user-name">${cuteName}</span>
            <button class="control-btn call-btn-action" style="width:36px; height:36px; margin-left:auto; transform:scale(0.8); background: var(--border-color);" onclick="callUser('${userId}')">
                <i class="ph-fill ph-phone" style="color:var(--success);"></i>
            </button>
        `;
        userList.appendChild(li);
    });
}

socket.on('update-user-list', ({ users }) => {
    users.forEach(u => { if(!onlineUsers.includes(u)) onlineUsers.push(u); });
    renderUserList();
});

socket.on('remove-user', ({ socketId }) => {
    onlineUsers = onlineUsers.filter(u => u !== socketId);
    renderUserList();
    
    // End call if the person disconnected
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
        remoteVideo.srcObject = null;
        remoteVideo.load();
    }
});


// ===================================
// WebRTC Network Logic (1-to-1 Calling)
// ===================================
let activeCallUserId = null;

// Helper: Make or Get Peer Connection
function createPeerConnection(socketId) {
    if (peerConnection) return peerConnection;
    
    peerConnection = new RTCPeerConnection(configuration);

    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }

    peerConnection.ontrack = event => {
        remoteVideo.srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.emit("ice-candidate", { to: socketId, candidate: event.candidate });
        }
    };
    
    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'closed') {
            peerConnection = null;
            remoteVideo.srcObject = null;
            remoteVideo.load();
            activeCallUserId = null;
        }
    };

    return peerConnection;
}

// 1. Send Call Request (Triggered by hitting the phone button)
function callUser(socketId) {
    if (!localStream) return alert("Camera/Mic not ready!");
    if (peerConnection) return alert("You are already connected to a call!");
    
    playClick();
    playRing(); // Outbound ringing
    activeCallUserId = socketId;
    socket.emit("call-request", { to: socketId, callerName: getCuteName(socket.id) || "Someone" });
}
window.callUser = callUser; 

// 2. Target receives Request (Ring UI)
socket.on("call-request", data => {
    if (peerConnection) {
        socket.emit("call-declined", { to: data.callerId });
        return;
    }

    playRing(); // Inbound ringing

    callerNameSpan.innerText = getCuteName(data.callerId);
    modal.classList.remove('hidden');
    
    btnAccept.onclick = () => {
        playClick();
        stopRing();
        activeCallUserId = data.callerId;
        modal.classList.add('hidden');
        socket.emit("call-accepted", { to: data.callerId });
    };
    
    btnDecline.onclick = () => {
        playClick();
        stopRing();
        activeCallUserId = null;
        modal.classList.add('hidden');
        socket.emit("call-declined", { to: data.callerId });
    };
});

// 3a. Ring Declined
socket.on("call-declined", data => {
    stopRing();
    alert(`${getCuteName(data.answererId)} declined your call or is busy.`);
});

// 3b. Ring Accepted -> Generate Offer
socket.on("call-accepted", async data => {
    stopRing();
    const pc = createPeerConnection(data.answererId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(new RTCSessionDescription(offer));
    socket.emit("call-user", { offer, to: data.answererId });
});

// 4. Target receives Offer -> Generate Answer
socket.on("call-made", async data => {
    const pc = createPeerConnection(data.socket);
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(new RTCSessionDescription(answer));
    socket.emit("make-answer", { answer, to: data.socket });
});

// 5. Sender receives Answer
socket.on("answer-made", async data => {
    if (peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
});

// ICE Exchanges
socket.on("ice-candidate-received", data => {
    if (peerConnection) peerConnection.addIceCandidate(data.candidate);
});

// Instant Teardown Signal from Remote
socket.on("call-ended", () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    remoteVideo.load();
    activeCallUserId = null;
    modal.classList.add('hidden');
});

// End All Calls
btnEnd.addEventListener('click', () => {
    playClick();
    stopRing();

    if (activeCallUserId) {
        socket.emit("end-call", { to: activeCallUserId });
        activeCallUserId = null;
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    remoteVideo.load();
    modal.classList.add('hidden');
    // Removed alert to make it instantly clean silently
});

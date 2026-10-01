// public/client.js
// Step 1 test page: shows connection status and measures ping round-trip time.

// Connect to the same server that served this page.
const socket = io();

// Page elements
const statusEl = document.getElementById('status');
const onlineEl = document.getElementById('online');
const pingBtn = document.getElementById('pingBtn');
const pingResultEl = document.getElementById('pingResult');
const pingLogEl = document.getElementById('pingLog');

// Convert English digits (0-9) to Bangla digits (০-৯) for display.
function toBanglaDigits(value) {
  const banglaDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(value).replace(/[0-9]/g, (d) => banglaDigits[Number(d)]);
}

// Update the status label text and color.
function setStatus(text, cssClass) {
  statusEl.textContent = text;
  statusEl.className = 'status ' + cssClass;
}

// --- Connection events ---
socket.on('connect', () => {
  setStatus('সংযুক্ত ✅', 'status-connected');
  pingBtn.disabled = false;
});

socket.on('disconnect', () => {
  setStatus('সংযোগ বিচ্ছিন্ন ❌', 'status-disconnected');
  pingBtn.disabled = true;
  onlineEl.textContent = '–';
});

socket.on('connect_error', () => {
  setStatus('সংযোগ করা যাচ্ছে না…', 'status-disconnected');
});

// Server tells us how many clients are online.
socket.on('online:count', (count) => {
  onlineEl.textContent = toBanglaDigits(count) + ' জন';
});

// --- Ping test ---
pingBtn.addEventListener('click', () => {
  const sentAt = Date.now();

  // Send our timestamp; the server replies through the callback.
  socket.emit('latency:ping', sentAt, () => {
    const roundTripMs = Date.now() - sentAt;
    const text = toBanglaDigits(roundTripMs) + ' মিলিসেকেন্ড';
    pingResultEl.textContent = text;

    // Add newest result to the top of the log.
    const li = document.createElement('li');
    const time = new Date().toLocaleTimeString('bn-BD');
    li.textContent = time + ' — ' + text;
    pingLogEl.prepend(li);
  });
});

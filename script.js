// Base URL for API calls – works locally and on Render
const API_BASE = `${window.location.origin}/api`;

// Per-device client ID so each user sees only their own library on the server
const CLIENT_ID_KEY = 'ytmp3_client_id_v1';
let CLIENT_ID = localStorage.getItem(CLIENT_ID_KEY);
if (!CLIENT_ID) {
    try {
        if (window.crypto && window.crypto.randomUUID) {
            CLIENT_ID = window.crypto.randomUUID();
        } else {
            CLIENT_ID = 'cid_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
        }
    } catch (e) {
        CLIENT_ID = 'cid_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    }
    localStorage.setItem(CLIENT_ID_KEY, CLIENT_ID);
}

function withClientId(url) {
    if (!url) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}client_id=${encodeURIComponent(CLIENT_ID)}`;
}

let currentFileId = null;
let statusCheckInterval = null;

// Global owner flag (set on DOMContentLoaded)
window.IS_OWNER = false;

const form = document.getElementById('convertForm');
const urlInput = document.getElementById('youtubeUrl');
const convertBtn = document.getElementById('convertBtn');
const folderSelect = document.getElementById('folderSelect');
const newFolderBtn = document.getElementById('newFolderBtn');
const deleteFolderBtn = document.getElementById('deleteFolderBtn');
const statusMessage = document.getElementById('statusMessage');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const downloadContainer = document.getElementById('downloadContainer');
const downloadTitle = document.getElementById('downloadTitle');
const downloadBtn = document.getElementById('downloadBtn');
const folderTabs = document.getElementById('folderTabs');
const folderModal = document.getElementById('folderModal');
const newFolderName = document.getElementById('newFolderName');
const createFolderBtn = document.getElementById('createFolderBtn');
const cancelFolderBtn = document.getElementById('cancelFolderBtn');
const closeFolderModal = document.getElementById('closeFolderModal');

let currentFolder = '';
const PLAYBACK_KEY = 'ytmp3_playback_state_v1';
window._yt_userStopped = false;

// Playlist / autoplay globals (declare early to avoid TDZ issues)
let currentAudioPlayer = null;
let currentPlaylist = [];
let currentPlaylistIndex = -1;
let isAutoPlayEnabled = false;

// ==========================================
// FIXED: PROPER FORM HANDLING WITH FOLDER SUPPORT
// ==========================================
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const url = urlInput.value.trim();
    const folder = folderSelect.value; // Get selected folder name
    const bitrate = document.getElementById('bitrateSelect').value || '64';
    
    console.log("=== FORM SUBMIT ===");
    console.log("URL:", url);
    console.log("FOLDER selected:", folder);
    console.log("BITRATE:", bitrate);
    
    if (!url) {
        showError('Please enter a YouTube URL');
        return;
    }
    
    // Reset UI
    hideAllMessages();
    convertBtn.disabled = true;
    convertBtn.querySelector('.btn-text').style.display = 'none';
    convertBtn.querySelector('.btn-loader').style.display = 'inline-block';
    
    try {
        // Prepare data to send - SIMPLE AND CLEAN
        const requestData = {
            url: url,
            bitrate: bitrate
        };
        
        // ONLY add folder if it's not empty or "root"
        if (folder && folder.trim() && folder !== 'root') {
            requestData.folder = folder.trim();
        }
        
        console.log("Sending to server:", JSON.stringify(requestData));
        
        const response = await fetch(`${API_BASE}/convert`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Client-Id': CLIENT_ID,
            },
            body: JSON.stringify(requestData),
        });
        
        const data = await response.json();
        console.log("Server response:", data);
        
        if (!response.ok) {
            // Handle duplicate (conflict) specially
            if (response.status === 409 && data && data.existing_file_id) {
                const msg = data.message || data.error || 'This link already exists';
                // Offer to open existing file
                if (confirm(msg + "\n\nOpen existing file now?")) {
                    window.location.href = withClientId(`${API_BASE}/download/${data.existing_file_id}`);
                }
                throw new Error(data.error || msg || 'Conversion cancelled');
            }

            throw new Error(data.error || 'Conversion failed');
        }
        
        currentFileId = data.file_id;
        console.log("Conversion started! File ID:", currentFileId);
        
        showProgress();
        startStatusCheck();
        
    } catch (error) {
        console.error("Convert error:", error);
        showError(error.message || 'Failed to start conversion. Make sure the server is running.');
        resetButton();
    }
});

// SIMPLE STATUS CHECK
function startStatusCheck() {
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
    }
    
    statusCheckInterval = setInterval(async () => {
        if (!currentFileId) return;
        
        try {
            const response = await fetch(withClientId(`${API_BASE}/status/${currentFileId}`), {
                headers: {
                    'X-Client-Id': CLIENT_ID
                }
            });
            const data = await response.json();
            
            if (data.status === 'completed') {
                clearInterval(statusCheckInterval);
                showDownload(data.filename, data.title);
                resetButton();
                // Refresh library
                setTimeout(() => {
                    loadFolders();
                    loadLibrary(currentFolder || null);
                }, 2000);
            } else if (data.status === 'error') {
                clearInterval(statusCheckInterval);
                showError(data.message || 'Conversion failed');
                resetButton();
            } else {
                updateProgress();
            }
        } catch (error) {
            console.error('Status check error:', error);
        }
    }, 2000);
}

function updateProgress() {
    const currentWidth = parseInt(progressFill.style.width) || 0;
    if (currentWidth < 90) {
        progressFill.style.width = (currentWidth + 10) + '%';
    }
}

// Fetch song info (used by admin Get Info)
async function fetchSongInfo() {
    try {
        const url = (urlInput && urlInput.value) ? urlInput.value.trim() : '';
        if (!url) {
            showError('Please enter a YouTube URL');
            return;
        }

        hideAllMessages();
        const resp = await fetch(`${API_BASE}/song-info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
            body: JSON.stringify({ url })
        });

        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.error || 'Failed to fetch info');
        }

        const infoEl = document.getElementById('song-info');
        if (infoEl) infoEl.style.display = 'flex';
        const thumb = document.getElementById('info-thumb'); if (thumb) thumb.src = data.thumbnail || '';
        const title = document.getElementById('info-title'); if (title) title.textContent = data.title || '';
        const dur = document.getElementById('info-duration'); if (dur) dur.textContent = data.duration ? ('Duration: ' + Math.floor(data.duration/60) + ':' + String(data.duration%60).padStart(2,'0')) : '';
        const uploader = document.getElementById('info-uploader'); if (uploader) uploader.textContent = data.uploader || '';

    } catch (e) {
        console.error('fetchSongInfo error', e);
        showError(e.message || 'Failed to fetch song info');
    }
}

function showProgress() {
    progressContainer.style.display = 'block';
    progressFill.style.width = '10%';
    progressText.textContent = 'Downloading and converting...';
}

function showDownload(filename, title) {
    progressContainer.style.display = 'none';
    downloadContainer.style.display = 'block';
    downloadTitle.textContent = title || 'Audio File';
    
    downloadBtn.onclick = () => {
        window.location.href = withClientId(`${API_BASE}/download/${currentFileId}`);
        
        setTimeout(() => {
            fetch(withClientId(`${API_BASE}/cleanup/${currentFileId}`), {
                method: 'DELETE',
                headers: {
                    'X-Client-Id': CLIENT_ID
                }
            }).catch(console.error);
            
            setTimeout(() => {
                hideAllMessages();
                urlInput.value = '';
                currentFileId = null;
            }, 2000);
        }, 1000);
    };
}

function showError(message) {
    statusMessage.textContent = message;
    statusMessage.className = 'status-message error';
    statusMessage.style.display = 'block';
    progressContainer.style.display = 'none';
    downloadContainer.style.display = 'none';
}

function showSuccess(message) {
    statusMessage.textContent = message;
    statusMessage.className = 'status-message success';
    statusMessage.style.display = 'block';
}

function hideAllMessages() {
    statusMessage.style.display = 'none';
    progressContainer.style.display = 'none';
    downloadContainer.style.display = 'none';
}

function resetButton() {
    convertBtn.disabled = false;
    convertBtn.querySelector('.btn-text').style.display = 'inline';
    convertBtn.querySelector('.btn-loader').style.display = 'none';
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
    }
    savePlaybackState();
});

// Library functionality
const libraryContainer = document.getElementById('libraryContainer');
const libraryList = document.getElementById('libraryList');
const libraryLoading = document.getElementById('libraryLoading');
const libraryEmpty = document.getElementById('libraryEmpty');
const refreshBtn = document.getElementById('refreshBtn');
const playerModal = document.getElementById('playerModal');
const audioPlayer = document.getElementById('audioPlayer');
const playerTitle = document.getElementById('playerTitle');
const closePlayer = document.getElementById('closePlayer');
const rewindBtn = document.getElementById('rewindBtn');
const skipBtn = document.getElementById('skipBtn');

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
    .then(reg => {
        console.log('Service Worker registered', reg);
    }).catch(err => console.warn('SW registration failed', err));

    navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data || {};
        if (data && data.type === 'NOTIFICATION_ACTION') {
            handleNotificationAction(data.action);
        }
    });
}

async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    try {
        const perm = await Notification.requestPermission();
        return perm === 'granted';
    } catch (e) {
        return false;
    }
}

// Load library on page load
window.addEventListener('DOMContentLoaded', async () => {
    console.log("🎵 TuneVerse App Started");
    
    // Check if owner
    let isOwner = true;
    try {
        const resp = await fetch(withClientId(`${API_BASE}/is-owner`), {
            headers: { 'X-Client-Id': CLIENT_ID }
        });
        if (resp.ok) {
            const data = await resp.json();
                isOwner = !!data.is_owner;
                console.log("Is owner?", isOwner);
                // expose globally so library render can hide owner-only controls
                window.IS_OWNER = isOwner;

            // Auto-claim admin only when accessed via localhost (NOT general LAN IPs)
            if (!isOwner) {
                const hostname = window.location.hostname;
                const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '';
                if (isLocalhost && data.owner_id) {
                    console.info('Localhost detected — setting clientId to owner id to enable admin UI');
                    // Prevent repeated reload loops by remembering we auto-claimed once
                    const AUTO_CLAIM_KEY = 'ytmp3_auto_claimed_v1';
                    const alreadyClaimed = localStorage.getItem(AUTO_CLAIM_KEY) === '1';
                    if (!alreadyClaimed) {
                        CLIENT_ID = data.owner_id;
                        localStorage.setItem(CLIENT_ID_KEY, CLIENT_ID);
                        localStorage.setItem(AUTO_CLAIM_KEY, '1');
                        // reload so the app initialises as owner
                        setTimeout(() => location.reload(), 200);
                        return;
                    } else {
                        console.info('Auto-claim already performed previously; skipping reload.');
                    }
                }
            }
        }
    } catch (e) {
        console.warn('Failed to determine owner status', e);
    }

    if (!isOwner) {
        const converterCard = document.getElementById('converterCard');
        if (converterCard) converterCard.style.display = 'none';
        if (newFolderBtn) newFolderBtn.style.display = 'none';
        if (deleteFolderBtn) deleteFolderBtn.style.display = 'none';
    }

    // Helper wrappers for Play All / Play Album buttons
    function playAll() {
        playAllSongs();
    }

    function playAlbum() {
        if (!currentFolder) {
            alert('Please select a folder first');
            return;
        }
        playFolderSongs(currentFolder);
    }

    // Attach Play All / Play Album buttons if present
    const playAllBtn = document.getElementById('playAllBtn');
    const playAlbumBtn = document.getElementById('playAlbumBtn');
    if (playAllBtn) playAllBtn.addEventListener('click', playAll);
    if (playAlbumBtn) playAlbumBtn.addEventListener('click', playAlbum);

    loadLibrary();
    loadFolders();
    restorePlaybackState();
    
    // Set up delete folder button
    if (deleteFolderBtn) {
        deleteFolderBtn.addEventListener('click', async () => {
            const selectedFolder = folderSelect.value;
            
            if (!selectedFolder || selectedFolder === '' || selectedFolder === 'root') {
                alert('Please select a folder to delete');
                return;
            }
            
            if (!confirm(`Are you sure you want to delete the folder "${selectedFolder}"?\n\n⚠️ This will delete ALL songs in this folder!`)) {
                return;
            }
            
            try {
                const response = await fetch(withClientId(`${API_BASE}/folders?name=${encodeURIComponent(selectedFolder)}`), {
                    method: 'DELETE',
                    headers: {
                        'X-Client-Id': CLIENT_ID
                    }
                });
                
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.error || 'Failed to delete folder');
                }
                
                showSuccess(`Folder "${selectedFolder}" deleted successfully! ${data.deleted_count || 0} songs removed.`);
                
                // Refresh everything
                setTimeout(() => {
                    loadFolders();
                    loadLibrary(currentFolder || null);
                    hideAllMessages();
                }, 2000);
                
            } catch (error) {
                console.error('Error deleting folder:', error);
                alert(error.message || 'Error deleting folder');
            }
        });
    }
});

refreshBtn.addEventListener('click', () => {
    loadLibrary();
    loadFolders();
});

// Audio player functions
closePlayer.addEventListener('click', () => {
    playerModal.style.display = 'none';
    audioPlayer.pause();
    audioPlayer.src = '';
    window._yt_userStopped = true;
    savePlaybackState();
});

rewindBtn.addEventListener('click', () => {
    audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 10);
});

skipBtn.addEventListener('click', () => {
    audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 10);
});

playerModal.addEventListener('click', (e) => {
    if (e.target === playerModal) {
        playerModal.style.display = 'none';
        audioPlayer.pause();
        audioPlayer.src = '';
        window._yt_userStopped = true;
        savePlaybackState();
    }
});

async function loadLibrary(folderFilter = null) {
    libraryLoading.style.display = 'block';
    libraryList.innerHTML = '';
    libraryEmpty.style.display = 'none';
    
    try {
        let url;
        if (folderFilter) {
            url = withClientId(`${API_BASE}/files?folder=${encodeURIComponent(folderFilter)}`);
        } else {
            url = withClientId(`${API_BASE}/files`);
        }
        
        const response = await fetch(url, {
            headers: {
                'X-Client-Id': CLIENT_ID
            }
        });
        
        const data = await response.json();
        libraryLoading.style.display = 'none';
        
        let files = [];
        if (folderFilter) {
            // Filtered view
            if (data.files) {
                files = data.files;
            } else if (data.folders && data.folders[folderFilter]) {
                files = data.folders[folderFilter];
            } else {
                files = [];
            }
        } else {
            // All files view
            files = data.root || [];
            if (data.folders) {
                Object.values(data.folders).forEach(folderFiles => {
                    files = files.concat(folderFiles);
                });
            }
            files.sort((a, b) => b.modified - a.modified);
        }
        
        if (files.length > 0) {
            files.forEach(file => {
                const item = createLibraryItem(file);
                libraryList.appendChild(item);
            });
        } else {
            libraryEmpty.style.display = 'block';
        }
    } catch (error) {
        libraryLoading.style.display = 'none';
        libraryEmpty.style.display = 'block';
        libraryEmpty.innerHTML = '<p>Error loading files. Please try again.</p>';
        console.error('Error loading library:', error);
    }
}

function createLibraryItem(file) {
    const item = document.createElement('div');
    item.className = 'library-card';
    
    const size = formatFileSize(file.size);
    const date = new Date(file.modified * 1000).toLocaleDateString();
    
    const colors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
        '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B88B', '#52C41A'
    ];
    const colorIndex = file.display_name.charCodeAt(0) % colors.length;
    const bgColor = colors[colorIndex];
    
    const initials = file.display_name.split(' ')[0].substring(0, 2).toUpperCase();
    
    const folderLabel = file.folder ? `<span class="card-folder-badge">${escapeHtml(file.folder)}</span>` : '';
    
    const thumbnailStyle = file.thumbnail 
        ? `background-image: url('${file.thumbnail}'); background-size: cover; background-position: center;`
        : `background: linear-gradient(135deg, ${bgColor} 0%, ${adjustBrightness(bgColor, -30)} 100%);`;
    
    const thumbnailContent = file.thumbnail 
        ? '' 
        : `<div class="card-initials">${initials}</div>`;
    
    const file_id = file.file_id || file.filename.replace('.mp3', '');
    
    // Build actions (hide delete for non-owners)
    let actionsHtml = `
        <button class="card-action-btn play-btn" data-fileid="${file_id}" data-name="${escapeHtml(file.display_name)}" title="Play">▶️</button>
        <button class="card-action-btn download-file-btn" data-fileid="${file_id}" title="Download">⬇️</button>
    `;

    // Only show delete action to owners and not on the public user page
    if (window.IS_OWNER && !document.body.classList.contains('user-page')) {
        actionsHtml += `<button class="card-action-btn delete-btn" data-fileid="${file_id}" data-filename="${file.filename}" title="Delete">🗑️</button>`;
    }

    item.innerHTML = `
        <div class="card-thumbnail" style="${thumbnailStyle}">
            ${thumbnailContent}
            <span class="card-duration">🎵</span>
        </div>
        <div class="card-content">
            <div class="card-title">${escapeHtml(file.display_name)}</div>
            <div class="card-meta">
                <div class="card-size">${size}</div>
                ${folderLabel}
            </div>
            <div class="card-date">${date}</div>
        </div>
        <div class="card-actions">
            ${actionsHtml}
        </div>
    `;
    
    const playBtn = item.querySelector('.play-btn');
    const downloadBtn = item.querySelector('.download-file-btn');
    const deleteBtn = item.querySelector('.delete-btn');
    
    playBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const fileId = playBtn.dataset.fileid;
        const name = playBtn.dataset.name;
        
        console.log("🎵 Play button clicked for file:", fileId);
        console.log("🎵 Song name:", name);
        
        try {
            // First get the audio URL from /api/play endpoint
            const playUrl = withClientId(`${API_BASE}/play/${fileId}`);
            console.log("📡 Fetching audio URL from:", playUrl);
            
            const response = await fetch(playUrl, {
                headers: {
                    'X-Client-Id': CLIENT_ID
                }
            });
            
            if (!response.ok) {
                throw new Error(`Failed to get audio URL: ${response.status}`);
            }
            
            const data = await response.json();
            console.log("📡 Audio URL response:", data);
            
            if (data.success && data.url) {
                // Now play the audio with the direct URL
                playAudioDirect(data.url, name);
            } else {
                console.error('❌ Invalid response from server:', data);
                alert('Error: Could not get audio URL from server');
            }
        } catch (error) {
            console.error('❌ Error getting audio URL:', error);
            alert('Error: ' + error.message);
        }
    });
    
    downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fileId = downloadBtn.dataset.fileid;
        window.location.href = withClientId(`${API_BASE}/download/${fileId}`);
    });
    
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm('Are you sure you want to delete this file?')) {
                const fileId = deleteBtn.dataset.fileid;
                const filename = deleteBtn.dataset.filename;
                await deleteFile(fileId, filename);
            }
        });
    }
    
    return item;
}

function adjustBrightness(color, percent) {
    const num = parseInt(color.replace("#",""), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return "#" + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 +
        (G<255?G<1?0:G:255)*0x100 + (B<255?B<1?0:B:255))
        .toString(16).slice(1);
}

// FIXED: playAudioDirect function that takes direct audio URL
function playAudioDirect(audioUrl, name) {
    console.log("🎵 Playing audio directly:", audioUrl);
    console.log("🎵 Song name:", name);
    
    playerTitle.textContent = name;
    
    // Ensure the URL is absolute
    if (!audioUrl.startsWith('http')) {
        if (audioUrl.startsWith('/')) {
            audioUrl = `${window.location.origin}${audioUrl}`;
        } else if (audioUrl.startsWith('api/')) {
            audioUrl = `${window.location.origin}/${audioUrl}`;
        } else {
            audioUrl = `${API_BASE}/${audioUrl}`;
        }
    }
    
    console.log("🎵 Final audio URL:", audioUrl);
    
    audioPlayer.pause();
    audioPlayer.src = '';
    audioPlayer.load();
    
    audioPlayer.src = audioUrl;
    playerModal.style.display = 'block';
    playerModal.classList.remove('minimized');
    
    // Add event listeners for debugging
    audioPlayer.addEventListener('error', (e) => {
        console.error('❌ Audio player error:', e);
        console.error('❌ Audio error details:', audioPlayer.error);
    });
    
    audioPlayer.addEventListener('loadeddata', () => {
        console.log('✅ Audio data loaded');
    });
    
    audioPlayer.addEventListener('canplay', () => {
        console.log('✅ Audio can play now');
    });
    
    audioPlayer.play().then(() => {
        console.log("✅ Audio started playing successfully");
        updateMediaSession(name);
    }).catch(e => {
        console.error('❌ Error playing audio:', e);
        console.error('❌ Audio error code:', audioPlayer.error?.code);
        console.error('❌ Audio error message:', audioPlayer.error?.message);
        
        // Try alternative approach - open in new tab
        if (confirm('Cannot play audio directly. Would you like to open it in a new tab?')) {
            window.open(audioUrl, '_blank');
        }
    });
}

function updateMediaSession(title) {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: title,
            artist: '',
            album: ''
        });

        navigator.mediaSession.setActionHandler('play', () => { audioPlayer.play(); });
        navigator.mediaSession.setActionHandler('pause', () => { audioPlayer.pause(); });
        navigator.mediaSession.setActionHandler('seekbackward', (details) => { audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - (details.seekOffset || 10)); });
        navigator.mediaSession.setActionHandler('seekforward', (details) => { audioPlayer.currentTime = Math.min(audioPlayer.duration || 0, audioPlayer.currentTime + (details.seekOffset || 10)); });
    }
}

function savePlaybackState() {
    try {
        const state = {
            url: audioPlayer.src || null,
            title: playerTitle.textContent || '',
            currentTime: Math.max(0, Math.floor(audioPlayer.currentTime || 0)),
            isPlaying: !!(audioPlayer && !audioPlayer.paused && !audioPlayer.ended),
            userStopped: !!window._yt_userStopped
        };
        localStorage.setItem(PLAYBACK_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn('Failed saving playback state', e);
    }
}

function loadPlaybackState() {
    try {
        const raw = localStorage.getItem(PLAYBACK_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        console.warn('Failed reading playback state', e);
        return null;
    }
}

function clearPlaybackState() {
    try { localStorage.removeItem(PLAYBACK_KEY); } catch(e){}
}

function restorePlaybackState() {
    const st = loadPlaybackState();
    if (!st) return;
    if (st.userStopped) return;
    if (st.url && st.isPlaying) {
        playAudioDirect(st.url, st.title || '');
        const onCanPlay = () => {
            try { audioPlayer.currentTime = st.currentTime || 0; } catch(e){}
            audioPlayer.removeEventListener('canplay', onCanPlay);
            audioPlayer.play().catch(()=>{});
        };
        audioPlayer.addEventListener('canplay', onCanPlay);
    } else if (st.url) {
        audioPlayer.src = st.url;
        audioPlayer.addEventListener('loadedmetadata', function once() {
            try { audioPlayer.currentTime = st.currentTime || 0; } catch(e){}
            audioPlayer.removeEventListener('loadedmetadata', once);
        });
    }
}

let _saveThrottle = 0;
audioPlayer.addEventListener('timeupdate', () => {
    const now = Date.now();
    if (now - _saveThrottle > 1800) {
        _saveThrottle = now;
        savePlaybackState();
    }
});

function handleNotificationAction(action) {
    switch(action) {
        case 'rewind':
            audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 10);
            break;
        case 'forward':
            audioPlayer.currentTime = Math.min(audioPlayer.duration || 0, audioPlayer.currentTime + 10);
            break;
        case 'playpause':
            if (audioPlayer.paused) {
                audioPlayer.play();
                window._yt_userStopped = false;
            } else {
                audioPlayer.pause();
                window._yt_userStopped = true;
            }
            savePlaybackState();
            break;
        case 'close':
            audioPlayer.pause();
            window._yt_userStopped = true;
            savePlaybackState();
            if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
                navigator.serviceWorker.getRegistration().then(reg => { 
                    if (reg && reg.getNotifications) 
                        reg.getNotifications({tag:'now-playing'}).then(notifs=> notifs.forEach(n=>n.close())); 
                });
            }
            break;
    }
}

async function deleteFile(fileId, filename) {
    try {
        const encodedFilename = encodeURIComponent(`${fileId}.mp3`);
        const url = withClientId(`${API_BASE}/delete-file/${encodedFilename}`);
        
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'X-Client-Id': CLIENT_ID
            }
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showSuccess('File deleted successfully');
            setTimeout(() => {
                loadFolders();
                loadLibrary(currentFolder || null);
                hideAllMessages();
            }, 1000);
        } else {
            showError('Error deleting file: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error deleting file:', error);
        showError('Error deleting file: ' + error.message);
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

const originalShowDownload = showDownload;
showDownload = function(filename, title) {
    originalShowDownload(filename, title);
    setTimeout(() => {
        loadFolders();
        loadLibrary(currentFolder || null);
    }, 3000);
};

setInterval(() => {
    loadFolders();
    loadLibrary(currentFolder || null);
}, 10000);

// ==========================================
// FIXED: FOLDER MANAGEMENT
// ==========================================
async function loadFolders() {
    try {
        const response = await fetch(withClientId(`${API_BASE}/folders`), {
            headers: {
                'X-Client-Id': CLIENT_ID
            }
        });
        
        const data = await response.json();

        // Clear existing options
        folderSelect.innerHTML = '<option value="">Save to Root (No folder)</option>';
        folderTabs.innerHTML = '<button class="folder-tab active" data-folder="">All Files</button>';

        if (data.folders && data.folders.length > 0) {
            data.folders.forEach(folder => {
                // Don't include "root" as a folder option
                if (folder.name === 'root') return;
                
                // Add to dropdown
                const opt = document.createElement('option');
                opt.value = folder.name;
                opt.textContent = `${folder.name} (${folder.file_count} files)`;
                folderSelect.appendChild(opt);

                // Add to tabs
                const tab = document.createElement('button');
                tab.className = 'folder-tab';
                tab.dataset.folder = folder.name;
                tab.innerHTML = `
                    ${folder.name} (${folder.file_count})
                    ${window.IS_OWNER ? `<span class="folder-delete-icon" data-folder="${folder.name}" title="Delete folder">🗑️</span>` : ''}
                `;
                folderTabs.appendChild(tab);
            });
        }

        // Attach tab click listeners
        Array.from(folderTabs.querySelectorAll('.folder-tab')).forEach(tab => {
            tab.addEventListener('click', (e) => {
                // Don't trigger if clicking delete icon
                if (e.target.classList.contains('folder-delete-icon')) {
                    e.stopPropagation();
                    return;
                }
                
                Array.from(folderTabs.querySelectorAll('.folder-tab')).forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentFolder = tab.dataset.folder || '';
                loadLibrary(currentFolder || null);
            });
        });

        // Attach delete icon listeners
        Array.from(folderTabs.querySelectorAll('.folder-delete-icon')).forEach(icon => {
            icon.addEventListener('click', async (e) => {
                e.stopPropagation();
                const folderName = icon.dataset.folder;
                
                if (!confirm(`Are you sure you want to delete the folder "${folderName}"?\n\n⚠️ This will delete ALL ${icon.parentNode.textContent.match(/\((\d+)/)?.[1] || '0'} songs in this folder!`)) {
                    return;
                }
                
                try {
                    const response = await fetch(withClientId(`${API_BASE}/folders?name=${encodeURIComponent(folderName)}`), {
                        method: 'DELETE',
                        headers: {
                            'X-Client-Id': CLIENT_ID
                        }
                    });
                    
                    const data = await response.json();
                    
                    if (!response.ok) {
                        throw new Error(data.error || 'Failed to delete folder');
                    }
                    
                    showSuccess(`Folder "${folderName}" deleted successfully! ${data.deleted_count || 0} songs removed.`);
                    
                    // Refresh everything
                    setTimeout(() => {
                        loadFolders();
                        loadLibrary(currentFolder || null);
                        hideAllMessages();
                    }, 2000);
                    
                } catch (error) {
                    console.error('Error deleting folder:', error);
                    alert(error.message || 'Error deleting folder');
                }
            });
        });
        // Defensive: hide/remove delete icons if this client is not owner
        if (!window.IS_OWNER) {
            Array.from(folderTabs.querySelectorAll('.folder-delete-icon')).forEach(icon => icon.remove());
        }
    } catch (error) {
        console.error('Error loading folders:', error);
    }
}

// Modal handlers
newFolderBtn.addEventListener('click', () => {
    folderModal.style.display = 'block';
    newFolderName.value = '';
    newFolderName.focus();
});

cancelFolderBtn.addEventListener('click', () => {
    folderModal.style.display = 'none';
    newFolderName.value = '';
});

closeFolderModal.addEventListener('click', () => {
    folderModal.style.display = 'none';
    newFolderName.value = '';
});

createFolderBtn.addEventListener('click', async () => {
    const name = newFolderName.value.trim();
    if (!name) {
        alert('Please enter a folder name');
        return;
    }

    try {
        const response = await fetch(withClientId(`${API_BASE}/folders`), {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-Client-Id': CLIENT_ID
            },
            body: JSON.stringify({ name })
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to create folder');
        }

        folderModal.style.display = 'none';
        newFolderName.value = '';
        
        // Refresh folder list
        await loadFolders();
        
        // Select the newly created folder in dropdown
        for(let i = 0; i < folderSelect.options.length; i++) {
            if (folderSelect.options[i].value === name) {
                folderSelect.selectedIndex = i;
                console.log(`✅ Auto-selected new folder: "${name}"`);
                break;
            }
        }
        
        showSuccess(`Folder "${name}" created successfully! Now select a YouTube URL to download.`);
        setTimeout(() => { hideAllMessages(); }, 3000);
    } catch (error) {
        console.error('Error creating folder:', error);
        alert(error.message || 'Error creating folder');
    }
});

folderModal.addEventListener('click', (e) => {
    if (e.target === folderModal) {
        folderModal.style.display = 'none';
        newFolderName.value = '';
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && folderModal.style.display === 'block') {
        folderModal.style.display = 'none';
        newFolderName.value = '';
    }
});

// Allow Enter key to create folder in modal
newFolderName.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        createFolderBtn.click();
    }
});

// ==========================================
// TEST FUNCTION: Direct folder selection (for debugging)
// ==========================================
window.selectFolder = function(folderName) {
    console.log("Manually selecting folder:", folderName);
    
    // Find and select in dropdown
    for(let i = 0; i < folderSelect.options.length; i++) {
        if (folderSelect.options[i].value === folderName) {
            folderSelect.selectedIndex = i;
            console.log("✅ Selected folder:", folderName, "at index", i);
            alert(`✅ Folder selected: "${folderName}"\n\nNow paste a YouTube URL and click Convert!`);
            return true;
        }
    }
    
    console.log("❌ Folder not found:", folderName);
    alert(`❌ Folder "${folderName}" not found in list.\n\nPlease create it first using the "+ New Folder" button.`);
    return false;
};

// Auto-focus URL input for better UX
window.addEventListener('load', function() {
    setTimeout(() => {
        urlInput.focus();
    }, 1000);
});





// ==========================================
// NEW: AUTO-PLAY SYSTEM FOR SONGS
// ==========================================

// Auto-play settings
const AUTO_PLAY_SETTINGS = {
    enabled: localStorage.getItem('autoplay_enabled') === 'true' || false,
    shuffle: localStorage.getItem('autoplay_shuffle') === 'true' || false,
    repeat: localStorage.getItem('autoplay_repeat') || 'all' // 'all', 'one', 'none'
};

// Save autoplay settings
function saveAutoplaySettings() {
    localStorage.setItem('autoplay_enabled', AUTO_PLAY_SETTINGS.enabled);
    localStorage.setItem('autoplay_shuffle', AUTO_PLAY_SETTINGS.shuffle);
    localStorage.setItem('autoplay_repeat', AUTO_PLAY_SETTINGS.repeat);
}

// Play a song with autoplay
function playSongWithAutoplay(fileId, title, playlist = [], index = -1) {
    if (playlist.length > 0 && index >= 0) {
        currentPlaylist = playlist;
        currentPlaylistIndex = index;
        isAutoPlayEnabled = true;
    }
    
    playAudioDirectWithAutoplay(fileId, title);
}

// Modified play function with autoplay
function playAudioDirectWithAutoplay(audioUrl, name) {
    console.log("🎵 Playing with autoplay:", audioUrl);
    
    playerTitle.textContent = name;
    
    // Ensure the URL is absolute
    if (!audioUrl.startsWith('http')) {
        if (audioUrl.startsWith('/')) {
            audioUrl = `${window.location.origin}${audioUrl}`;
        } else if (audioUrl.startsWith('api/')) {
            audioUrl = `${window.location.origin}/${audioUrl}`;
        } else {
            audioUrl = `${API_BASE}/${audioUrl}`;
        }
    }
    
    console.log("🎵 Final audio URL:", audioUrl);
    
    // Pause and reset current player
    if (currentAudioPlayer) {
        currentAudioPlayer.pause();
        currentAudioPlayer.onended = null;
    }
    
    audioPlayer.src = audioUrl;
    audioPlayer.load();
    playerModal.style.display = 'block';
    playerModal.classList.remove('minimized');
    
    // Store as current player
    currentAudioPlayer = audioPlayer;
    
    // Setup autoplay when song ends
    audioPlayer.onended = function() {
        console.log("🎵 Song ended, checking autoplay...");
        if (isAutoPlayEnabled && currentPlaylist.length > 0) {
            playNextInPlaylist();
        }
    };
    
    audioPlayer.play().then(() => {
        console.log("✅ Audio started playing");
        updateMediaSession(name);
        
        // Show autoplay status
        updateAutoplayStatus();
    }).catch(e => {
        console.error('❌ Error playing audio:', e);
    });
}

// Play next song in playlist
function playNextInPlaylist() {
    if (currentPlaylist.length === 0 || currentPlaylistIndex === -1) {
        console.log("No playlist available");
        return;
    }
    
    let nextIndex;
    
    // Handle repeat modes
    if (AUTO_PLAY_SETTINGS.repeat === 'one') {
        // Repeat same song
        nextIndex = currentPlaylistIndex;
    } else {
        // Calculate next index
        if (AUTO_PLAY_SETTINGS.shuffle) {
            nextIndex = getRandomIndex();
        } else {
            nextIndex = currentPlaylistIndex + 1;
        }
        
        // Handle end of playlist
        if (nextIndex >= currentPlaylist.length) {
            if (AUTO_PLAY_SETTINGS.repeat === 'all') {
                nextIndex = 0; // Loop to beginning
            } else if (AUTO_PLAY_SETTINGS.repeat === 'none') {
                console.log("Autoplay stopped (repeat: none)");
                isAutoPlayEnabled = false;
                updateAutoplayStatus();
                return;
            }
        }
    }
    
    // Get next song
    const nextSong = currentPlaylist[nextIndex];
    if (nextSong && nextSong.file_id) {
        console.log(`▶️ Playing next: ${nextSong.display_name || 'Unknown'}`);
        currentPlaylistIndex = nextIndex;
        
        // Get audio URL and play
        fetch(withClientId(`${API_BASE}/play/${nextSong.file_id}`), {
            headers: { 'X-Client-Id': CLIENT_ID }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.url) {
                playAudioDirectWithAutoplay(data.url, nextSong.display_name || 'Unknown');
            }
        })
        .catch(error => {
            console.error('Error getting next song:', error);
            // Try next song after delay
            setTimeout(playNextInPlaylist, 1000);
        });
    }
}

// Get random index (for shuffle)
function getRandomIndex() {
    if (currentPlaylist.length <= 1) return 0;
    
    let newIndex;
    do {
        newIndex = Math.floor(Math.random() * currentPlaylist.length);
    } while (newIndex === currentPlaylistIndex && currentPlaylist.length > 1);
    
    return newIndex;
}

// Update autoplay status display
function updateAutoplayStatus() {
    const statusEl = document.getElementById('autoplayStatus');
    if (!statusEl) {
        // Create status element if doesn't exist
        const statusDiv = document.createElement('div');
        statusDiv.id = 'autoplayStatus';
        statusDiv.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 5px 10px;
            border-radius: 15px;
            font-size: 12px;
            display: ${isAutoPlayEnabled ? 'block' : 'none'};
            z-index: 1001;
        `;
        playerModal.appendChild(statusDiv);
    }
    
    const statusText = isAutoPlayEnabled ? 
        `🎵 Autoplay: ${AUTO_PLAY_SETTINGS.shuffle ? '🔀' : '▶️'} ${currentPlaylist.length} songs` : 
        '⏸️ Autoplay off';
    
    document.getElementById('autoplayStatus').innerHTML = `
        <span>${statusText}</span>
        <button onclick="toggleAutoplaySettings()" style="margin-left: 10px; background: transparent; border: none; color: white; cursor: pointer;">⚙️</button>
    `;
    document.getElementById('autoplayStatus').style.display = isAutoPlayEnabled ? 'block' : 'none';
}

// Toggle autoplay settings
function toggleAutoplaySettings() {
    const settingsHtml = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 2000;">
            <div style="background: white; padding: 20px; border-radius: 10px; width: 300px; color: black;">
                <h3 style="margin-top: 0;">🎵 Autoplay Settings</h3>
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 10px;">
                        <input type="checkbox" id="autoplayEnabled" ${AUTO_PLAY_SETTINGS.enabled ? 'checked' : ''}>
                        Enable Autoplay
                    </label>
                    <label style="display: block; margin-bottom: 10px;">
                        <input type="checkbox" id="autoplayShuffle" ${AUTO_PLAY_SETTINGS.shuffle ? 'checked' : ''}>
                        🔀 Shuffle
                    </label>
                    <div style="margin-bottom: 10px;">
                        <label>Repeat:</label>
                        <select id="autoplayRepeat" style="margin-left: 10px;">
                            <option value="all" ${AUTO_PLAY_SETTINGS.repeat === 'all' ? 'selected' : ''}>All</option>
                            <option value="one" ${AUTO_PLAY_SETTINGS.repeat === 'one' ? 'selected' : ''}>One Song</option>
                            <option value="none" ${AUTO_PLAY_SETTINGS.repeat === 'none' ? 'selected' : ''}>None</option>
                        </select>
                    </div>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <button onclick="saveAutoplaySettingsModal()" style="background: #4CAF50; color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer;">Save</button>
                    <button onclick="closeAutoplaySettings()" style="background: #f44336; color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer;">Close</button>
                </div>
            </div>
        </div>
    `;
    
    const existingModal = document.getElementById('autoplaySettingsModal');
    if (existingModal) existingModal.remove();
    
    const modal = document.createElement('div');
    modal.id = 'autoplaySettingsModal';
    modal.innerHTML = settingsHtml;
    document.body.appendChild(modal);
}

// Save settings from modal
function saveAutoplaySettingsModal() {
    AUTO_PLAY_SETTINGS.enabled = document.getElementById('autoplayEnabled').checked;
    AUTO_PLAY_SETTINGS.shuffle = document.getElementById('autoplayShuffle').checked;
    AUTO_PLAY_SETTINGS.repeat = document.getElementById('autoplayRepeat').value;
    
    saveAutoplaySettings();
    isAutoPlayEnabled = AUTO_PLAY_SETTINGS.enabled && currentPlaylist.length > 0;
    
    closeAutoplaySettings();
    updateAutoplayStatus();
}

// Close settings modal
function closeAutoplaySettings() {
    const modal = document.getElementById('autoplaySettingsModal');
    if (modal) modal.remove();
}

// Play all songs in current view
function playAllSongs() {
    const songCards = document.querySelectorAll('.library-card');
    if (songCards.length === 0) {
        alert('No songs found to play');
        return;
    }
    
    const playlist = Array.from(songCards).map(card => {
        const playBtn = card.querySelector('.play-btn');
        return {
            file_id: playBtn.dataset.fileid,
            display_name: playBtn.dataset.name
        };
    });
    
    if (playlist.length > 0) {
        currentPlaylist = playlist;
        currentPlaylistIndex = 0;
        isAutoPlayEnabled = true;
        
        // Play first song
        fetch(withClientId(`${API_BASE}/play/${playlist[0].file_id}`), {
            headers: { 'X-Client-Id': CLIENT_ID }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.url) {
                playAudioDirectWithAutoplay(data.url, playlist[0].display_name);
                alert(`🎵 Playing ${playlist.length} songs with autoplay!`);
            }
        });
    }
}

// Play all songs in a folder
function playFolderSongs(folderName) {
    fetch(withClientId(`${API_BASE}/files?folder=${encodeURIComponent(folderName)}`), {
        headers: { 'X-Client-Id': CLIENT_ID }
    })
    .then(async response => {
        if (!response.ok) {
            const txt = await response.text().catch(() => '');
            throw new Error(`Server returned ${response.status}: ${txt}`);
        }
        return response.json();
    })
    .then(data => {
        let songs = [];

        // Accept multiple response shapes (files, folders map, array of folder objects, or root)
        if (data.files && Array.isArray(data.files) && data.files.length > 0) {
            songs = data.files;
        } else if (data.folders) {
            if (Array.isArray(data.folders)) {
                const matched = data.folders.find(f => f.name === folderName || f.folder === folderName);
                if (matched) {
                    songs = matched.files || matched.items || [];
                }
            } else if (data.folders[folderName]) {
                songs = data.folders[folderName];
            }
        } else if (data.root && Array.isArray(data.root)) {
            songs = data.root.filter(f => (f.folder || '') === folderName);
        }

        if (!Array.isArray(songs) || songs.length === 0) {
            alert('No songs found in this folder');
            return;
        }

        const playlist = songs.map(song => ({
            file_id: song.file_id || (song.filename || '').replace('.mp3', ''),
            display_name: song.display_name || song.title || 'Unknown'
        }));

        currentPlaylist = playlist;
        currentPlaylistIndex = 0;
        isAutoPlayEnabled = true;

        // Play first song
        fetch(withClientId(`${API_BASE}/play/${playlist[0].file_id}`), {
            headers: { 'X-Client-Id': CLIENT_ID }
        })
        .then(async resp => {
            if (!resp.ok) {
                const tx = await resp.text().catch(()=>'');
                throw new Error(`Play endpoint returned ${resp.status}: ${tx}`);
            }
            return resp.json();
        })
        .then(data => {
            if (data.success && data.url) {
                playAudioDirectWithAutoplay(data.url, playlist[0].display_name);
                alert(`🎵 Playing ${playlist.length} songs from "${folderName}" with autoplay!`);
            } else {
                throw new Error('Invalid response from play endpoint');
            }
        })
        .catch(err => {
            console.error('Error starting playback:', err);
            alert('Error starting playback: ' + (err.message || 'Unknown'));
        });
    })
    .catch(error => {
        console.error('Error loading folder:', error);
        alert('Error loading folder songs: ' + (error.message || 'Unknown'));
    });
}

// Add Play All button to UI
function addPlayAllButtons() {
    // Add Play All button to library header
    const libraryHeader = document.querySelector('.library-header');
    if (libraryHeader && !document.getElementById('playAllBtn')) {
        const playAllBtn = document.createElement('button');
        playAllBtn.id = 'playAllBtn';
        playAllBtn.innerHTML = '▶️ Play All';
        playAllBtn.style.cssText = `
            background: #4CAF50;
            color: white;
            border: none;
            padding: 8px 15px;
            border-radius: 5px;
            cursor: pointer;
            margin-left: 10px;
            font-size: 14px;
        `;
        playAllBtn.onclick = playAllSongs;
        libraryHeader.appendChild(playAllBtn);
    }
    
    // Add Play All button to each folder tab
    const folderTabs = document.getElementById('folderTabs');
    if (folderTabs) {
        const folderTabButtons = folderTabs.querySelectorAll('.folder-tab');
        folderTabButtons.forEach(tab => {
            if (!tab.querySelector('.play-folder-btn')) {
                const folderName = tab.dataset.folder;
                if (folderName) {
                    const playFolderBtn = document.createElement('span');
                    playFolderBtn.className = 'play-folder-btn';
                    playFolderBtn.innerHTML = '▶️';
                    playFolderBtn.title = 'Play all songs in this folder';
                    playFolderBtn.style.cssText = `
                        margin-left: 5px;
                        cursor: pointer;
                        opacity: 0.7;
                    `;
                    playFolderBtn.onclick = (e) => {
                        e.stopPropagation();
                        playFolderSongs(folderName);
                    };
                    tab.appendChild(playFolderBtn);
                }
            }
        });
    }
}

// Initialize autoplay system
function initAutoplaySystem() {
    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && playerModal.style.display === 'block') {
            e.preventDefault();
            if (audioPlayer.paused) {
                audioPlayer.play();
            } else {
                audioPlayer.pause();
            }
        }
        
        if (e.code === 'KeyN' && isAutoPlayEnabled) {
            e.preventDefault();
            playNextInPlaylist();
        }
        
        if (e.code === 'KeyP' && isAutoPlayEnabled && currentPlaylistIndex > 0) {
            e.preventDefault();
            currentPlaylistIndex = Math.max(0, currentPlaylistIndex - 1);
            const prevSong = currentPlaylist[currentPlaylistIndex];
            if (prevSong) {
                fetch(withClientId(`${API_BASE}/play/${prevSong.file_id}`), {
                    headers: { 'X-Client-Id': CLIENT_ID }
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success && data.url) {
                        playAudioDirectWithAutoplay(data.url, prevSong.display_name);
                    }
                });
            }
        }
    });
    
    // Add Play All buttons
    addPlayAllButtons();
    
    // Update buttons periodically
    setInterval(addPlayAllButtons, 3000);
    
    console.log("🎵 Autoplay system initialized");
}

// Replace existing playAudioDirect function
const originalPlayAudioDirect = window.playAudioDirect;
window.playAudioDirect = function(audioUrl, name) {
    // Use new autoplay system
    if (isAutoPlayEnabled && currentPlaylist.length > 0) {
        // Find current song in playlist
        const currentIndex = currentPlaylist.findIndex(song => 
            name.includes(song.display_name) || song.display_name.includes(name)
        );
        
        if (currentIndex !== -1) {
            currentPlaylistIndex = currentIndex;
        }
        
        playAudioDirectWithAutoplay(audioUrl, name);
    } else {
        // Use original function without autoplay
        originalPlayAudioDirect(audioUrl, name);
    }
};

// Initialize when page loads
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(initAutoplaySystem, 2000);
});

// Make functions globally available
window.playAllSongs = playAllSongs;
window.playFolderSongs = playFolderSongs;
window.toggleAutoplaySettings = toggleAutoplaySettings;
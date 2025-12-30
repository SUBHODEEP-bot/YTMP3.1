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

// Remember last selected folder for admin so they don't have to re-select repeatedly
const SELECTED_FOLDER_KEY = 'ytmp3_selected_folder_v1';

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
let _endWatcherInterval = null; // fallback watcher for ended event
let _isAdvancingPlaylist = false; // guard to prevent double-advance

// Auto-play settings - defined early to avoid TDZ errors
const AUTO_PLAY_SETTINGS = {
    enabled: localStorage.getItem('autoplay_enabled') === 'true' || false,
    shuffle: localStorage.getItem('autoplay_shuffle') === 'true' || false,
    repeat: localStorage.getItem('autoplay_repeat') || 'all' // 'all', 'one', 'none'
};

// Popup persistent player window reference
window._persistentPlayer = null;
window._persistentPlayerReady = false;

function openPersistentPlayer() {
    try {
        if (window._persistentPlayer && !window._persistentPlayer.closed) return window._persistentPlayer;
        // Open small popup; user must allow popups for this to work
        const w = window.open('/player.html', 'ytt_persistent_player', 'width=480,height=120');
        window._persistentPlayer = w;
        window._persistentPlayerReady = false;

        // Listen for ready message
        const onMsg = (ev) => {
            if (ev.origin !== window.location.origin) return;
            const m = ev.data || {};
            if (m.type === 'player_ready') {
                window._persistentPlayerReady = true;
                window.removeEventListener('message', onMsg);
            }
        };
        window.addEventListener('message', onMsg);

        return w;
    } catch (e) { console.warn('Failed to open persistent player', e); return null; }
}

function sendToPersistentPlayer(msg) {
    try {
        const w = openPersistentPlayer();
        if (!w) return false;
        // Post immediately; the popup will buffer/ignore if not ready
        w.postMessage(msg, window.location.origin);
        return true;
    } catch (e) { console.warn('sendToPersistentPlayer error', e); return false; }
}

// Save autoplay settings
function saveAutoplaySettings() {
    localStorage.setItem('autoplay_enabled', AUTO_PLAY_SETTINGS.enabled);
    localStorage.setItem('autoplay_shuffle', AUTO_PLAY_SETTINGS.shuffle);
    localStorage.setItem('autoplay_repeat', AUTO_PLAY_SETTINGS.repeat);
}

// ==========================================
// FIXED: PROPER FORM HANDLING WITH FOLDER SUPPORT
// ==========================================
if (form) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const url = (urlInput && urlInput.value) ? urlInput.value.trim() : '';
        const folder = (folderSelect && folderSelect.value) ? folderSelect.value : '';
        const bitrate = (document.getElementById('bitrateSelect') && document.getElementById('bitrateSelect').value) ? document.getElementById('bitrateSelect').value : '64';
    
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
}

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

    // Hide admin-only elements on user pages
    const converterCard = document.getElementById('converterCard');
    if (converterCard && !isOwner) {
        converterCard.style.display = 'none';
    }
    if (newFolderBtn && !isOwner) {
        newFolderBtn.style.display = 'none';
    }
    if (deleteFolderBtn && !isOwner) {
        deleteFolderBtn.style.display = 'none';
    }

    // Initialize different views based on page type
    const foldersContainer = document.getElementById('foldersContainer');
    if (foldersContainer) {
        // User dashboard - load folder cards
        console.log('🎵 Loading user dashboard with folder cards');
        attachUserDashboardListeners();
        loadFolderCards();
    } else {
        // Admin dashboard - load library and folders
        console.log('🎵 Loading admin dashboard');
        if (typeof loadLibrary === 'function' && libraryContainer) loadLibrary();
        if (typeof loadFolders === 'function' && folderSelect) loadFolders();
    }
    
    restorePlaybackState();
    
    // Initialize autoplay system
    setTimeout(initAutoplaySystem, 2000);
    
    // Set up delete folder button (admin only)
    if (deleteFolderBtn && isOwner) {
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

if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
        if (typeof loadLibrary === 'function') loadLibrary();
        if (typeof loadFolders === 'function') loadFolders();
    });
}

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

// Keep service worker notification in sync with play/pause
audioPlayer.addEventListener('play', () => {
    try {
        window._yt_userStopped = false;
        showNowPlayingNotification(playerTitle.textContent || 'Now Playing', '', audioPlayer.src || null, null, true);
        savePlaybackState();
    } catch (e) { console.warn(e); }
});
audioPlayer.addEventListener('pause', () => {
    try {
        showNowPlayingNotification(playerTitle.textContent || 'Now Playing', '', audioPlayer.src || null, null, false);
        savePlaybackState();
    } catch (e) { console.warn(e); }
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
    if (!libraryContainer) return; // Not on admin page
    
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

// FIXED: playAudioDirect function that takes direct audio URL - NO POPUP
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

    // FIX: Do NOT try persistent popup - always play in current page
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
        showNowPlayingNotification(name, '', audioUrl, null, true);
    }).catch(e => {
        console.error('❌ Error playing audio:', e);
        console.error('❌ Audio error code:', audioPlayer.error?.code);
        console.error('❌ Audio error message:', audioPlayer.error?.message);
        
        // FIX: Don't open in new tab automatically
        showError('Cannot play audio. Please try again.');
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

// Show persistent now-playing notification via service worker (if available)
function showNowPlayingNotification(title, artist, url, thumbnail, isPlaying) {
    try {
        if (!('serviceWorker' in navigator)) return;
        const msg = {
            type: 'SHOW_NOW_PLAYING',
            title: title || 'Now Playing',
            artist: artist || '',
            url: url || null,
            thumbnail: thumbnail || null,
            isPlaying: !!isPlaying
        };

        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage(msg);
        } else if (navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then(reg => {
                if (reg.active) reg.active.postMessage(msg);
            }).catch(()=>{});
        }
    } catch (e) {
        console.warn('Notification post failed', e);
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
        // Remember current selection so we can restore it after refresh
        const prevSelectedFolder = (folderSelect && folderSelect.value) ? folderSelect.value : '';

        const response = await fetch(withClientId(`${API_BASE}/folders`), {
            headers: {
                'X-Client-Id': CLIENT_ID
            }
        });
        
        const data = await response.json();

        // Clear existing options (but remember previous selection)
        if (folderSelect) {
            folderSelect.innerHTML = '<option value="">Save to Root (No folder)</option>';
        }
        if (folderTabs) {
            folderTabs.innerHTML = '<button class="folder-tab" data-folder="">All Files</button>';
        }

        if (data.folders && data.folders.length > 0) {
            data.folders.forEach(folder => {
                // Don't include "root" as a folder option
                if (folder.name === 'root') return;
                
                // Add to dropdown
                if (folderSelect) {
                    const opt = document.createElement('option');
                    opt.value = folder.name;
                    opt.textContent = `${folder.name} (${folder.file_count} files)`;
                    folderSelect.appendChild(opt);
                }

                // Add to tabs
                if (folderTabs) {
                    const tab = document.createElement('button');
                    tab.className = 'folder-tab';
                    tab.dataset.folder = folder.name;
                    tab.innerHTML = `
                        ${folder.name} (${folder.file_count})
                        ${window.IS_OWNER ? `<span class="folder-delete-icon" data-folder="${folder.name}" title="Delete folder">🗑️</span>` : ''}
                    `;
                    folderTabs.appendChild(tab);
                }
            });
        }

        // Restore previous selection if still available.
        // Prefer the dropdown's previous value, else use the saved selection in localStorage.
        const savedSelected = localStorage.getItem(SELECTED_FOLDER_KEY) || '';
        const desired = prevSelectedFolder || savedSelected || '';
        if (desired && folderSelect) {
            for (let i = 0; i < folderSelect.options.length; i++) {
                if (folderSelect.options[i].value === desired) {
                    folderSelect.selectedIndex = i;
                    currentFolder = desired;
                    try { localStorage.setItem(SELECTED_FOLDER_KEY, desired || ''); } catch(e){}
                    break;
                }
            }
        }

        // Ensure folder tab active state matches currentFolder (or previous selection)
        if (folderTabs) {
            const activeFolder = currentFolder || prevSelectedFolder || '';
            Array.from(folderTabs.querySelectorAll('.folder-tab')).forEach(t => {
                if ((t.dataset.folder || '') === activeFolder) t.classList.add('active');
                else t.classList.remove('active');
            });

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
                    // Mirror selection to dropdown and persist
                    if (folderSelect) {
                        for (let i = 0; i < folderSelect.options.length; i++) {
                            if (folderSelect.options[i].value === currentFolder) {
                                folderSelect.selectedIndex = i;
                                break;
                            }
                        }
                    }
                    try { localStorage.setItem(SELECTED_FOLDER_KEY, currentFolder || ''); } catch(e){}
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
        }
    } catch (error) {
        console.error('Error loading folders:', error);
    }
}

// Modal handlers
if (newFolderBtn) {
    newFolderBtn.addEventListener('click', () => {
        folderModal.style.display = 'block';
        newFolderName.value = '';
        newFolderName.focus();
    });
}

if (cancelFolderBtn) {
    cancelFolderBtn.addEventListener('click', () => {
        folderModal.style.display = 'none';
        newFolderName.value = '';
    });
}

if (closeFolderModal) {
    closeFolderModal.addEventListener('click', () => {
        folderModal.style.display = 'none';
        newFolderName.value = '';
    });
}

if (createFolderBtn) {
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
            if (folderSelect) {
                for(let i = 0; i < folderSelect.options.length; i++) {
                    if (folderSelect.options[i].value === name) {
                        folderSelect.selectedIndex = i;
                        currentFolder = name;
                        try { localStorage.setItem(SELECTED_FOLDER_KEY, name); } catch(e){}
                        console.log(`✅ Auto-selected new folder: "${name}"`);
                        break;
                    }
                }
            }
            
            showSuccess(`Folder "${name}" created successfully! Now select a YouTube URL to download.`);
            setTimeout(() => { hideAllMessages(); }, 3000);
        } catch (error) {
            console.error('Error creating folder:', error);
            alert(error.message || 'Error creating folder');
        }
    });
}

if (folderModal) {
    folderModal.addEventListener('click', (e) => {
        if (e.target === folderModal) {
            folderModal.style.display = 'none';
            newFolderName.value = '';
        }
    });
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && folderModal && folderModal.style.display === 'block') {
        folderModal.style.display = 'none';
        newFolderName.value = '';
    }
});

// Allow Enter key to create folder in modal
if (newFolderName) {
    newFolderName.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            createFolderBtn.click();
        }
    });
}

// ==========================================
// TEST FUNCTION: Direct folder selection (for debugging)
// ==========================================
window.selectFolder = function(folderName) {
    console.log("Manually selecting folder:", folderName);
    
    if (!folderSelect) {
        console.log("❌ Folder select not available on this page");
        return false;
    }
    
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
        if (urlInput) urlInput.focus();
    }, 1000);
});

// Persist dropdown selection so admin doesn't need to re-select each upload
if (folderSelect) {
    // Restore from localStorage if present (will be applied after folders load)
    const saved = localStorage.getItem(SELECTED_FOLDER_KEY);
    if (saved) {
        // store into currentFolder so loadFolders can pick it up
        currentFolder = saved;
    }

    folderSelect.addEventListener('change', (e) => {
        const val = (e.target && e.target.value) ? e.target.value : '';
        try { localStorage.setItem(SELECTED_FOLDER_KEY, val || ''); } catch(e){}
        currentFolder = val || '';
    });
}

// ==========================================
// NEW: AUTO-PLAY SYSTEM FOR SONGS
// ==========================================

// Play a song with autoplay
function playSongWithAutoplay(fileId, title, playlist = [], index = -1) {
    if (playlist.length > 0 && index >= 0) {
        currentPlaylist = playlist;
        currentPlaylistIndex = index;
        isAutoPlayEnabled = true;
    }
    
    playAudioDirectWithAutoplay(fileId, title);
}

// Modified play function with autoplay - NO POPUP
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
    
    // FIX: Do NOT try persistent popup - always play in current page
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
    
    // CRITICAL: Preserve/enforce autoplay for playback
    const _wasAutoPlayEnabled = isAutoPlayEnabled;
    console.log("🎵 Starting playback - wasAutoPlayEnabled:", _wasAutoPlayEnabled, "currentPlaylist.length:", currentPlaylist.length);

    // Setup autoplay when song ends
    // Clear any previous ended watcher
    try { if (_endWatcherInterval) { clearInterval(_endWatcherInterval); _endWatcherInterval = null; } } catch(e){}

    console.log("🎵 Setting up playback - isAutoPlayEnabled:", isAutoPlayEnabled, "currentPlaylist.length:", currentPlaylist.length);

    audioPlayer.onended = function() {
        console.log("🎵 Song ended (onended), checking autoplay...");
        console.log("   isAutoPlayEnabled:", isAutoPlayEnabled, "playlist.length:", currentPlaylist.length, "index:", currentPlaylistIndex);
        if (isAutoPlayEnabled && currentPlaylist.length > 0) {
            playNextInPlaylist();
        }
    };

    // Fallback watcher: sometimes 'ended' may not fire reliably in some browsers; poll near end
    _endWatcherInterval = setInterval(() => {
        try {
            if (!audioPlayer || audioPlayer.duration === Infinity || isNaN(audioPlayer.duration) || audioPlayer.duration <= 0) return;
            if (!audioPlayer.paused && audioPlayer.currentTime >= (audioPlayer.duration - 0.6)) {
                console.log('🎵 Fallback watcher: detected near-end, autoPlayEnabled:', isAutoPlayEnabled, 'playlist:', currentPlaylist.length);
                clearInterval(_endWatcherInterval);
                _endWatcherInterval = null;
                if (isAutoPlayEnabled && currentPlaylist.length > 0) playNextInPlaylist();
            }
        } catch (e) { console.warn('End watcher error', e); }
    }, 400);
    
    audioPlayer.play().then(() => {
        console.log("✅ Audio started playing");
        updateMediaSession(name);
        // CRITICAL: Re-enforce autoplay after play starts
        isAutoPlayEnabled = isAutoPlayEnabled || _wasAutoPlayEnabled || currentPlaylist.length > 0;
        console.log("✅ Enforced isAutoPlayEnabled:", isAutoPlayEnabled);
        showNowPlayingNotification(name, '', audioUrl, null, true);
        
        // Reset the advancing flag so the next song can be queued
        _isAdvancingPlaylist = false;
        
        // Show autoplay status
        updateAutoplayStatus();
    }).catch(e => {
        console.error('❌ Error playing audio:', e);
        _isAdvancingPlaylist = false;
    });
}

// Play next song in playlist
function playNextInPlaylist() {
    // Guard: prevent double-advance if both onended and fallback watcher fire
    if (_isAdvancingPlaylist) {
        console.log("⏭️ Already advancing, ignoring duplicate call");
        return;
    }
    
    if (currentPlaylist.length === 0 || currentPlaylistIndex === -1) {
        console.log("No playlist available");
        return;
    }
    
    _isAdvancingPlaylist = true;
    
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
                _isAdvancingPlaylist = false;
                return;
            }
        }
    }
    
    // Get next song
    const nextSong = currentPlaylist[nextIndex];
    if (nextSong && nextSong.file_id) {
        console.log(`▶️ Playing next: ${nextSong.display_name || 'Unknown'} (index ${nextIndex})`);
        currentPlaylistIndex = nextIndex;
        
        // Get audio URL and play
        fetch(withClientId(`${API_BASE}/play/${nextSong.file_id}`), {
            headers: { 'X-Client-Id': CLIENT_ID }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.url) {
                console.log('🎵 Playing next song:', nextSong.display_name, 'from playlist index', currentPlaylistIndex);
                // Ensure autoplay stays enabled when playing next song
                const wasAutoPlayEnabled = isAutoPlayEnabled;
                playAudioDirectWithAutoplay(data.url, nextSong.display_name || 'Unknown');
                isAutoPlayEnabled = wasAutoPlayEnabled || isAutoPlayEnabled;
            } else {
                console.error('Invalid play response:', data);
                _isAdvancingPlaylist = false;
            }
        })
        .catch(error => {
            console.error('Error getting next song:', error);
            _isAdvancingPlaylist = false;
            // Try next song after delay
            setTimeout(playNextInPlaylist, 1000);
        });
    } else {
        _isAdvancingPlaylist = false;
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
    console.log('🎵 playAllSongs() START');
    const songCards = document.querySelectorAll('.library-card');
    console.log('🎵 Found', songCards.length, 'song cards');
    
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
    
    console.log('🎵 Built playlist with', playlist.length, 'songs');

    if (playlist.length > 0) {
        currentPlaylist = playlist;
        currentPlaylistIndex = 0;
        isAutoPlayEnabled = true;
        // Safe: only save if AUTO_PLAY_SETTINGS exists
        if (typeof AUTO_PLAY_SETTINGS !== 'undefined') {
            AUTO_PLAY_SETTINGS.enabled = true;
            saveAutoplaySettings();
        } else {
            localStorage.setItem('autoplay_enabled', 'true');
        }
        
        console.log('🎵 Set currentPlaylist, isAutoPlayEnabled=', isAutoPlayEnabled);
        
        // Request notification permission so background controls work
        requestNotificationPermission().catch(()=>{});

        console.log('🎵 Fetching first song:', playlist[0].file_id);
        fetch(withClientId(`${API_BASE}/play/${playlist[0].file_id}`), {
            headers: { 'X-Client-Id': CLIENT_ID }
        })
        .then(response => response.json())
        .then(data => {
            console.log('🎵 Got first song data:', data);
            if (data.success && data.url) {
                console.log('🎵 Calling playAudioDirectWithAutoplay()');
                playAudioDirectWithAutoplay(data.url, playlist[0].display_name);
                alert(`🎵 Playing ${playlist.length} songs with autoplay!`);
            } else {
                console.error('🎵 Error: invalid play response', data);
                alert('Error: Could not start playback');
            }
        })
        .catch(err => {
            console.error('🎵 Error fetching first song:', err);
            alert('Error starting playback: ' + err.message);
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
        // CRITICAL: Force autoplay enabled for folder playback
        isAutoPlayEnabled = true;
        // Also force the setting to match - safe check
        if (typeof AUTO_PLAY_SETTINGS !== 'undefined') {
            AUTO_PLAY_SETTINGS.enabled = true;
            saveAutoplaySettings();
        } else {
            localStorage.setItem('autoplay_enabled', 'true');
        }

        console.log('🎵 Playlist built:', playlist.length, 'songs. isAutoPlayEnabled:', isAutoPlayEnabled);

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

// Make functions globally available
window.playAllSongs = playAllSongs;
window.playFolderSongs = playFolderSongs;
window.toggleAutoplaySettings = toggleAutoplaySettings;

// ========================================
// USER DASHBOARD FOLDER CARD VIEW
// ========================================

let allFolders = []; // Store all folders for user dashboard
let currentViewingFolder = null; // Track which folder user is viewing

// Load and display folder cards (user dashboard)
async function loadFolderCards() {
    const foldersContainer = document.getElementById('foldersContainer');
    if (!foldersContainer) {
        console.log('❌ foldersContainer not found - not on user dashboard');
        return; // Not on user dashboard
    }
    
    try {
        console.log('📂 Loading folder cards...');
        foldersContainer.innerHTML = '<div class="loading-spinner">Loading playlists...</div>';
        
        const response = await fetch(withClientId(`${API_BASE}/folders`), {
            headers: { 'X-Client-Id': CLIENT_ID }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: Failed to load folders`);
        }
        
        const data = await response.json();
        console.log('📂 Folders data:', data);
        
        // Get folders array - try multiple response formats
        let folders = [];
        if (Array.isArray(data)) {
            folders = data;
        } else if (data.folders && Array.isArray(data.folders)) {
            folders = data.folders;
        } else if (data.data && Array.isArray(data.data)) {
            folders = data.data;
        }
        
        console.log('📂 Parsed folders:', folders);
        
        // Filter out "root" folder. Show folders even if file_count is zero
        folders = folders.filter(f => f.name !== 'root');
        
        allFolders = folders;
        
        if (folders.length === 0) {
            foldersContainer.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 40px 20px;">No playlists yet. Start uploading songs!</p>';
            return;
        }
        
        // Create folder cards with thumbnails
        let html = '';
        for (let i = 0; i < folders.length; i++) {
            const folder = folders[i];
            const songCount = folder.file_count || folder.count || 0;
            const folderName = folder.name || 'Unknown';
            
            // Get thumbnail from folder's files or use default
            let thumbnail = folder.thumbnail || folder.cover_image || '';
            
            // If no thumbnail, try to get first song's thumbnail
            if (!thumbnail && folder.files && folder.files.length > 0) {
                thumbnail = folder.files[0].thumbnail || '';
            }
            
            // Escape single quotes for onclick
            const escapedName = folderName.replace(/'/g, "\\'");
            
            // Generate background color for fallback
            const colors = [
                '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
                '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B88B', '#52C41A'
            ];
            const colorIndex = folderName.charCodeAt(0) % colors.length;
            const bgColor = colors[colorIndex];
            
            // Create initials for fallback
            const initials = folderName.substring(0, 2).toUpperCase();
            
            // Determine thumbnail style
            let thumbnailStyle = '';
            let thumbnailContent = '';
            
            if (thumbnail) {
                thumbnailStyle = `background-image: url('${thumbnail}'); background-size: cover; background-position: center;`;
                thumbnailContent = ''; // No initials when we have thumbnail
            } else {
                thumbnailStyle = `background: linear-gradient(135deg, ${bgColor} 0%, ${adjustBrightness(bgColor, -30)} 100%);`;
                thumbnailContent = `<div class="folder-initials">${initials}</div>`;
            }
            
            html += `
                <div class="folder-card" onclick="showFolderSongs('${escapedName}', ${songCount})" title="${folderName}">
                    <div class="folder-thumbnail" style="${thumbnailStyle}">
                        ${thumbnailContent}
                        <div class="folder-count-badge">${songCount} song${songCount !== 1 ? 's' : ''}</div>
                    </div>
                    <div class="folder-info">
                        <div class="folder-name">${folderName}</div>
                    </div>
                </div>
            `;
        }
        
        foldersContainer.innerHTML = html;
        console.log('✅ Folder cards loaded');
        
        // Add CSS for folder cards if not already present
        addFolderCardStyles();
        
    } catch (error) {
        console.error('❌ Error loading folders:', error);
        foldersContainer.innerHTML = `<p style="text-align:center; color: var(--danger); padding: 40px 20px;">Error loading playlists: ${error.message}</p>`;
    }
}

// Add CSS styles for folder cards - MOBILE OPTIMIZED
function addFolderCardStyles() {
    if (document.getElementById('folder-card-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'folder-card-styles';
    style.textContent = `
        .folders-container {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 15px;
            padding: 15px;
        }
        
        .folder-card {
            background: var(--card-bg);
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
            cursor: pointer;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            border: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            height: 200px;
        }
        
        .folder-card:hover {
            transform: translateY(-3px);
            box-shadow: 0 6px 12px rgba(0,0,0,0.15);
        }
        
        .folder-thumbnail {
            height: 120px;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            flex-shrink: 0;
        }
        
        .folder-initials {
            font-size: 28px;
            font-weight: bold;
            text-shadow: 1px 1px 3px rgba(0,0,0,0.3);
        }
        
        .folder-count-badge {
            position: absolute;
            bottom: 8px;
            right: 8px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 3px 6px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: 500;
        }
        
        .folder-info {
            padding: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex: 1;
        }
        
        .folder-name {
            font-weight: 600;
            color: var(--text-primary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            text-align: center;
            font-size: 14px;
            width: 100%;
        }
        
        /* Song cards in folder view */
        .songs-container {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
            gap: 12px;
            padding: 15px;
        }
        
        .song-card {
            background: var(--card-bg);
            border-radius: 10px;
            padding: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
            border: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            height: 180px;
        }
        
        .song-card:hover {
            background: var(--hover-bg);
            transform: translateY(-2px);
        }
        
        .song-thumbnail {
            width: 100%;
            height: 100px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 16px;
            margin-bottom: 8px;
            background-size: cover;
            background-position: center;
        }
        
        .song-card-initials {
            font-size: 24px;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.3);
        }
        
        .song-title {
            font-weight: 500;
            color: var(--text-primary);
            margin-bottom: 4px;
            overflow: hidden;
            text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            line-height: 1.3;
            font-size: 13px;
            flex: 1;
        }
        
        .song-meta {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            color: var(--text-secondary);
            margin-top: auto;
        }
        
        /* Loading spinner */
        .loading-spinner {
            text-align: center;
            padding: 30px;
            color: var(--text-secondary);
            font-style: italic;
            grid-column: 1 / -1;
        }
        
        /* Section transitions */
        .folders-section, .songs-section {
            transition: opacity 0.3s ease;
        }
        
        .back-button {
            background: none;
            border: none;
            color: var(--primary-color);
            cursor: pointer;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 10px;
        }
        
        .back-button:hover {
            opacity: 0.8;
        }
        
        .current-folder-title {
            margin: 0;
            color: var(--text-primary);
            font-size: 20px;
            font-weight: 600;
            padding: 0 15px;
        }
        
        /* Folder view header */
        .folder-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px;
            border-bottom: 1px solid var(--border-color);
            background: var(--card-bg);
        }
        
        .folder-actions {
            display: flex;
            gap: 8px;
        }
        
        .action-button {
            background: var(--primary-color);
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
        }
        
        .action-button:hover {
            opacity: 0.9;
        }
        
        /* Responsive adjustments */
        @media (max-width: 480px) {
            .folders-container {
                grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                gap: 12px;
                padding: 12px;
            }
            
            .folder-card {
                height: 180px;
            }
            
            .folder-thumbnail {
                height: 100px;
            }
            
            .songs-container {
                grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                gap: 10px;
                padding: 12px;
            }
            
            .song-card {
                height: 160px;
                padding: 10px;
            }
            
            .song-thumbnail {
                height: 90px;
            }
            
            .song-title {
                font-size: 12px;
                -webkit-line-clamp: 2;
            }
        }
        
        @media (max-width: 360px) {
            .folders-container {
                grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
            }
            
            .folder-card {
                height: 160px;
            }
            
            .folder-thumbnail {
                height: 90px;
            }
            
            .songs-container {
                grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
            }
            
            .song-card {
                height: 150px;
            }
            
            .song-thumbnail {
                height: 80px;
            }
        }
    `;
    
    document.head.appendChild(style);
}

// Show songs in a specific folder
async function showFolderSongs(folderName, songCount) {
    const foldersSection = document.getElementById('foldersSection');
    const songsSection = document.getElementById('songsSection');
    const songsContainer = document.getElementById('songsContainer');
    const currentFolderTitle = document.getElementById('currentFolderTitle');
    
    if (!songsSection || !songsContainer) {
        console.error('❌ Required elements not found for showFolderSongs');
        return;
    }
    
    try {
        console.log('📂 Opening folder:', folderName, 'songs:', songCount);
        
        currentViewingFolder = folderName;
        if (currentFolderTitle) currentFolderTitle.textContent = `${folderName} (${songCount} songs)`;
        songsContainer.innerHTML = '<div class="loading-spinner">Loading songs...</div>';
        
        // Hide folders, show songs
        if (foldersSection) foldersSection.style.display = 'none';
        songsSection.style.display = 'block';
        
        // Fetch songs in folder
        const response = await fetch(withClientId(`${API_BASE}/files?folder=${encodeURIComponent(folderName)}`), {
            headers: { 'X-Client-Id': CLIENT_ID }
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}: Failed to load songs`);
        
        const data = await response.json();
        console.log('📂 Folder songs data:', data);
        
        let songs = [];
        
        // Parse response - try multiple formats
        if (Array.isArray(data)) {
            songs = data;
        } else if (data.files && Array.isArray(data.files)) {
            songs = data.files;
        } else if (data.data && Array.isArray(data.data)) {
            songs = data.data;
        } else if (data.folders && data.folders[folderName]) {
            songs = data.folders[folderName];
        } else if (data.root && Array.isArray(data.root)) {
            songs = data.root.filter(s => (s.folder || '') === folderName);
        }
        
        console.log('📂 Parsed songs:', songs.length);
        
        if (songs.length === 0) {
            songsContainer.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 40px 20px; grid-column: 1/-1;">No songs in this playlist</p>';
            return;
        }
        
        // Build playlist for autoplay
        const playlist = songs.map(song => ({
            file_id: song.file_id || (song.filename || '').replace('.mp3', ''),
            display_name: song.display_name || song.title || 'Unknown',
            size: song.file_size || song.size || 0,
            thumbnail: song.thumbnail || ''
        }));
        
        currentPlaylist = playlist;
        currentPlaylistIndex = 0;
        isAutoPlayEnabled = true;
        if (typeof AUTO_PLAY_SETTINGS !== 'undefined') {
            AUTO_PLAY_SETTINGS.enabled = true;
            saveAutoplaySettings();
        }
        
        // Create song cards with thumbnails
        let html = '';
        for (let idx = 0; idx < songs.length; idx++) {
            const song = songs[idx];
            const displayName = song.display_name || song.title || 'Unknown Song';
            const size = song.file_size || song.size || 0;
            const sizeMB = size > 0 ? (size / (1024 * 1024)).toFixed(1) : '0.0';
            const thumbnail = song.thumbnail || '';
            
            // Escape for HTML
            const safeName = displayName.replace(/'/g, "\\'");
            const fileId = song.file_id || (song.filename || '').replace('.mp3', '');
            
            // Generate background color for fallback
            const colors = [
                '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
                '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B88B', '#52C41A'
            ];
            const colorIndex = displayName.charCodeAt(0) % colors.length;
            const bgColor = colors[colorIndex];
            const initials = displayName.substring(0, 2).toUpperCase();
            
            // Determine thumbnail style for song card
            let thumbnailStyle = '';
            let thumbnailContent = '';
            
            if (thumbnail) {
                thumbnailStyle = `background-image: url('${thumbnail}'); background-size: cover; background-position: center;`;
                thumbnailContent = ''; // No initials when we have thumbnail
            } else {
                thumbnailStyle = `background: linear-gradient(135deg, ${bgColor} 0%, ${adjustBrightness(bgColor, -30)} 100%);`;
                thumbnailContent = `<div class="song-card-initials">${initials}</div>`;
            }
            
            html += `
                <div class="song-card" onclick="playSongFromFolder(${idx}, '${fileId}', '${safeName}')" title="${displayName}">
                    <div class="song-thumbnail" style="${thumbnailStyle}">
                        ${thumbnailContent}
                    </div>
                    <div class="song-title">${displayName}</div>
                    <div class="song-meta">
                        <span class="song-size">${sizeMB} MB</span>
                        <span class="song-play">▶️ Play</span>
                    </div>
                </div>
            `;
        }
        
        songsContainer.innerHTML = html;
        
        // Auto-play first song
        console.log('🎵 Folder loaded, auto-playing first song...');
        if (playlist[0] && playlist[0].file_id) {
            setTimeout(() => {
                playFirstSongInFolder(playlist[0]);
            }, 500);
        }
        
    } catch (error) {
        console.error('❌ Error loading folder songs:', error);
        songsContainer.innerHTML = `<p style="text-align:center; color: var(--danger); padding: 40px 20px; grid-column: 1/-1;">Error loading songs: ${error.message}</p>`;
    }
}

// Play first song in folder (with autoplay)
function playFirstSongInFolder(song) {
    if (!song || !song.file_id) return;
    
    fetch(withClientId(`${API_BASE}/play/${song.file_id}`), {
        headers: { 'X-Client-Id': CLIENT_ID }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success && data.url) {
            playAudioDirectWithAutoplay(data.url, song.display_name || 'Unknown');
        }
    })
    .catch(err => console.error('Error playing first song:', err));
}

// Play a song from the current folder view
function playSongFromFolder(index, fileId, displayName) {
    if (!fileId) {
        console.error('No fileId provided');
        return;
    }
    
    currentPlaylistIndex = index;
    
    fetch(withClientId(`${API_BASE}/play/${fileId}`), {
        headers: { 'X-Client-Id': CLIENT_ID }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success && data.url) {
            playAudioDirectWithAutoplay(data.url, displayName);
        }
    })
    .catch(err => console.error('Error playing song:', err));
}

// Go back to folder view
function backToFolders() {
    const foldersSection = document.getElementById('foldersSection');
    const songsSection = document.getElementById('songsSection');
    
    if (foldersSection && songsSection) {
        songsSection.style.display = 'none';
        foldersSection.style.display = 'block';
        currentViewingFolder = null;
    }
}

// Play all songs in current folder
function playAllCurrentFolder() {
    if (currentPlaylist.length === 0) {
        alert('No songs to play');
        return;
    }
    
    // Start autoplay from first song
    isAutoPlayEnabled = true;
    if (typeof AUTO_PLAY_SETTINGS !== 'undefined') {
        AUTO_PLAY_SETTINGS.enabled = true;
        saveAutoplaySettings();
    }
    
    currentPlaylistIndex = 0;
    if (currentPlaylist[0] && currentPlaylist[0].file_id) {
        playFirstSongInFolder(currentPlaylist[0]);
    }
}

// Attach button event listeners for user dashboard
function attachUserDashboardListeners() {
    const refreshFoldersBtn = document.getElementById('refreshFoldersBtn');
    const backToFoldersBtn = document.getElementById('backToFoldersBtn');
    const playCurrentFolderBtn = document.getElementById('playCurrentFolderBtn');
    
    if (refreshFoldersBtn) {
        refreshFoldersBtn.addEventListener('click', loadFolderCards);
        console.log('✅ Attached refreshFoldersBtn');
    }
    
    if (backToFoldersBtn) {
        backToFoldersBtn.addEventListener('click', backToFolders);
        console.log('✅ Attached backToFoldersBtn');
    }
    
    if (playCurrentFolderBtn) {
        playCurrentFolderBtn.addEventListener('click', playAllCurrentFolder);
        console.log('✅ Attached playCurrentFolderBtn');
    }
}

// Export new user dashboard functions to global scope
window.loadFolderCards = loadFolderCards;
window.showFolderSongs = showFolderSongs;
window.playSongFromFolder = playSongFromFolder;
window.backToFolders = backToFolders;
window.playAllCurrentFolder = playAllCurrentFolder;
window.attachUserDashboardListeners = attachUserDashboardListeners;
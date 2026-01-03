 // Base URL for API calls – works locally and on Render
const API_BASE = `${window.location.origin}/api`;

// Quick toggle: force initials-collage fallback (skip remote thumbnails)
// Set to true to avoid external thumbnail loading issues; set to false to attempt thumbnails.
const FORCE_INITIALS_COLLAGE = false;

// Thumbnail cache key and helper functions (cache stored in localStorage)
const FOLDER_THUMB_CACHE_KEY = 'ytmp3_folder_thumb_cache_v1';
const FOLDER_THUMB_CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days

function loadFolderThumbCache() {
    try {
        const raw = localStorage.getItem(FOLDER_THUMB_CACHE_KEY);
        if (!raw) return {};
        return JSON.parse(raw) || {};
    } catch (e) { return {}; }
}

function saveFolderThumbCacheObj(obj) {
    try {
        localStorage.setItem(FOLDER_THUMB_CACHE_KEY, JSON.stringify(obj || {}));
    } catch (e) { console.warn('Failed saving folder thumb cache', e); }
}

function getCachedThumb(folderName) {
    try {
        const map = loadFolderThumbCache();
        const entry = map[folderName];
        if (!entry) return null;
        if (entry.ts && (Date.now() - entry.ts) > FOLDER_THUMB_CACHE_TTL) {
            // expired
            delete map[folderName];
            saveFolderThumbCacheObj(map);
            return null;
        }
        return entry;
    } catch (e) { return null; }
}

function saveFolderThumbCache(folderName, entry) {
    try {
        const map = loadFolderThumbCache();
        map[folderName] = Object.assign({}, entry, { ts: Date.now() });
        saveFolderThumbCacheObj(map);
    } catch (e) { console.warn('Failed to save folder cache', e); }
}

// --- Simple on-page diagnostic overlay to surface runtime errors and fetch failures ---
function showDebugOverlay(msg, level = 'error') {
    try {
        let el = document.getElementById('ytmp3_debug_overlay');
        if (!el) {
            el = document.createElement('div');
            el.id = 'ytmp3_debug_overlay';
            el.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;padding:10px;border-radius:8px;max-height:40vh;overflow:auto;font-size:13px;font-family:Arial,sans-serif;';
            document.body.appendChild(el);
        }
        const color = level === 'error' ? 'rgba(220,38,38,0.92)' : (level === 'warn' ? 'rgba(234,179,8,0.92)' : 'rgba(34,197,94,0.92)');
        el.style.background = color;
        el.style.color = '#fff';
        const time = new Date().toLocaleTimeString();
        el.innerHTML = `<strong>[${time}] ${level.toUpperCase()}:</strong><div style="margin-top:6px">${String(msg).replace(/\n/g,'<br>')}</div>`;
    } catch (e) { console.warn('Failed to show debug overlay', e); }
}

window.addEventListener('error', (ev) => {
    try { console.error('Unhandled error', ev.error || ev.message); showDebugOverlay(ev.error?.stack || ev.message || String(ev), 'error'); } catch(e){}
});
window.addEventListener('unhandledrejection', (ev) => {
    try { console.error('Unhandled rejection', ev.reason); showDebugOverlay(ev.reason && ev.reason.stack ? ev.reason.stack : String(ev.reason), 'error'); } catch(e){}
});

// Helper to show fetch failure overlay when API calls fail
function showFetchError(url, status, text) {
    showDebugOverlay(`Failed fetch ${url} — status: ${status}\n${text}`, 'warn');
}

// Folder songs cache (store list of songs per folder for faster playlist rendering)
const FOLDER_SONGS_CACHE_KEY = 'ytmp3_folder_songs_cache_v1';
const FOLDER_SONGS_CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

function loadFolderSongsCache() {
    try {
        const raw = localStorage.getItem(FOLDER_SONGS_CACHE_KEY);
        if (!raw) return {};
        return JSON.parse(raw) || {};
    } catch (e) { return {}; }
}

function saveFolderSongsCacheObj(obj) {
    try { localStorage.setItem(FOLDER_SONGS_CACHE_KEY, JSON.stringify(obj || {})); } catch(e) { console.warn('Failed saving folder songs cache', e); }
}

function getCachedFolderSongs(folderName) {
    try {
        const map = loadFolderSongsCache();
        const entry = map[folderName];
        if (!entry) return null;
        if (entry.ts && (Date.now() - entry.ts) > FOLDER_SONGS_CACHE_TTL) {
            delete map[folderName]; saveFolderSongsCacheObj(map); return null;
        }
        return entry.songs || null;
    } catch (e) { return null; }
}

function saveCachedFolderSongs(folderName, songs) {
    try {
        const map = loadFolderSongsCache();
        map[folderName] = { songs: songs || [], ts: Date.now() };
        saveFolderSongsCacheObj(map);
    } catch (e) { console.warn('Failed saving folder songs', e); }
}

// Build song cards HTML from songs array (used for cached + fresh rendering)
function buildSongCardsHtml(songs) {
    let html = '';
    for (let idx = 0; idx < songs.length; idx++) {
        const song = songs[idx];
        const displayName = song.display_name || song.title || 'Unknown Song';
        const size = song.file_size || song.size || 0;
        const sizeMB = size > 0 ? (size / (1024 * 1024)).toFixed(1) : '0.0';
        const thumbnail = song.thumbnail || '';
        const safeName = (displayName || '').replace(/'/g, "\\'");
        const fileId = song.file_id || (song.filename || '').replace('.mp3', '');

        const colors = ['#FF6B6B','#4ECDC4','#45B7D1','#FFA07A','#98D8C8','#F7DC6F','#BB8FCE','#85C1E2','#F8B88B','#52C41A'];
        const colorIndex = (displayName && displayName.charCodeAt(0)) ? displayName.charCodeAt(0) % colors.length : 0;
        const bgColor = colors[colorIndex];
        const initials = (displayName || '').substring(0,2).toUpperCase();

        let thumbnailStyle = '';
        let thumbnailContent = '';
        if (thumbnail) {
            thumbnailStyle = `background-image: url('${thumbnail}'); background-size: cover; background-position: center;`;
            thumbnailContent = '';
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
    return html;
}

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
window._persistentPlayerOpened = false; // Track if user has ever opened it

function openPersistentPlayer(autoOpen = false) {
    try {
        if (window._persistentPlayer && !window._persistentPlayer.closed) {
            // Popup already open, just focus it if not auto-opening
            if (!autoOpen) window._persistentPlayer.focus();
            return window._persistentPlayer;
        }
        // Open small popup; user must allow popups for this to work
        const w = window.open('/player.html', 'ytt_persistent_player', 'width=480,height=140');
        window._persistentPlayer = w;
        window._persistentPlayerReady = false;
        window._persistentPlayerOpened = true;

        if (!w) {
            console.warn('Persistent player popup was blocked by browser');
            window._persistentPlayerOpened = false;
            return null;
        }

        // Listen for ready message
        const onMsg = (ev) => {
            if (ev.origin !== window.location.origin) return;
            const m = ev.data || {};
            if (m.type === 'player_ready') {
                window._persistentPlayerReady = true;
                window.removeEventListener('message', onMsg);
                console.log('✅ Persistent player ready');
            }
        };
        window.addEventListener('message', onMsg);

        return w;
    } catch (e) { console.warn('Failed to open persistent player', e); return null; }
}

function sendToPersistentPlayer(msg) {
    try {
        // Only auto-open if user has explicitly opened it before, or if they're now clicking Play
        const shouldTryOpen = window._persistentPlayerOpened;
        const w = shouldTryOpen ? openPersistentPlayer(true) : window._persistentPlayer;
        
        if (!w || w.closed) {
            console.log('❌ Persistent player not open; falling back to in-page playback');
            return false;
        }
        
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
        // Defer folder loading to allow page to render first
        setTimeout(() => {
            loadFolderCards();
        }, 500);
    } else {
        // Admin dashboard - load library and folders
        console.log('🎵 Loading admin dashboard');
        if (typeof loadLibrary === 'function' && libraryContainer) loadLibrary();
        if (typeof loadFolders === 'function' && folderSelect) loadFolders();
    }
    
    restorePlaybackState();
    
    // Initialize autoplay system
    setTimeout(initAutoplaySystem, 2000);
    
    // Set up persistent player button (user dashboard only)
    const openPlayerBtn = document.getElementById('openPersistentPlayerBtn');
    if (openPlayerBtn) {
        openPlayerBtn.addEventListener('click', () => {
            const w = openPersistentPlayer(false);
            if (w && !w.closed) {
                console.log('✅ Persistent player opened. Music will continue playing when you leave this tab.');
                alert('🎧 Persistent player opened!\n\nNow when you play music, it will play in this window. You can leave this tab and music will keep playing.');
            } else {
                alert('❌ Could not open persistent player. Please check if popups are blocked in your browser settings.');
            }
        });
    }
    
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

// Keep notifications in sync with play/pause
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
        // Hide modal when clicking outside content, but do NOT stop playback.
        // This ensures resizing or accidental outside-clicks won't interrupt audio.
        playerModal.style.display = 'none';
        // Keep audioPlayer.src and playback state intact so music continues.
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

// Show now-playing notification
function showNowPlayingNotification(title, artist, url, thumbnail, isPlaying) {
    // Notifications disabled
    return;
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
    // Try to hand off playback to a persistent popup player so audio can continue
    // when the main tab is closed or navigated away from.
    try {
        const msg = {
            type: 'play',
            url: audioUrl,
            title: name,
            playlist: currentPlaylist && currentPlaylist.length ? currentPlaylist : [],
            currentIndex: currentPlaylistIndex,
            apiBase: API_BASE,
            clientId: CLIENT_ID
        };
        const sent = sendToPersistentPlayer(msg);
        if (sent) {
            console.log('➡️ Playback handed off to persistent player popup');
            // Show player modal briefly to indicate playback started, but keep it minimized
            playerModal.style.display = 'none';
            // Update media session and notifications to reflect new state
            updateMediaSession(name);
            showNowPlayingNotification(name, '', audioUrl, null, true);
            return; // do not play in-page when popup is used
        }
    } catch (e) { console.warn('Persistent player handoff failed', e); }

    // Fallback: play in current page
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
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 2000; padding: 16px;">
            <div style="background: white; padding: 24px; border-radius: 12px; width: 100%; max-width: 380px; color: black; max-height: 90vh; overflow-y: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.3);">
                <h3 style="margin-top: 0; font-size: 18px; margin-bottom: 20px;">🎵 Autoplay Settings</h3>
                <div style="margin-bottom: 20px;">
                    <label style="display: flex; align-items: center; margin-bottom: 14px; font-size: 15px; cursor: pointer;">
                        <input type="checkbox" id="autoplayEnabled" ${AUTO_PLAY_SETTINGS.enabled ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; margin-right: 10px;">
                        <span>Enable Autoplay</span>
                    </label>
                    <label style="display: flex; align-items: center; margin-bottom: 14px; font-size: 15px; cursor: pointer;">
                        <input type="checkbox" id="autoplayShuffle" ${AUTO_PLAY_SETTINGS.shuffle ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; margin-right: 10px;">
                        <span>🔀 Shuffle</span>
                    </label>
                    <div style="margin-bottom: 14px;">
                        <label style="display: block; font-size: 15px; margin-bottom: 8px;">Repeat:</label>
                        <select id="autoplayRepeat" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; cursor: pointer;">
                            <option value="all" ${AUTO_PLAY_SETTINGS.repeat === 'all' ? 'selected' : ''}>All</option>
                            <option value="one" ${AUTO_PLAY_SETTINGS.repeat === 'one' ? 'selected' : ''}>One Song</option>
                            <option value="none" ${AUTO_PLAY_SETTINGS.repeat === 'none' ? 'selected' : ''}>None</option>
                        </select>
                    </div>
                </div>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button onclick="saveAutoplaySettingsModal()" style="background: #4CAF50; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;">Save</button>
                    <button onclick="closeAutoplaySettings()" style="background: #f44336; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;">Close</button>
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
        
        // OPTIMIZATION: Fetch ALL files ONCE instead of per-folder
        console.log('📂 Fetching all files for thumbnails (optimization)...');
        let allFilesData = {};
        try {
            const filesResponse = await fetch(withClientId(`${API_BASE}/files`), {
                headers: { 'X-Client-Id': CLIENT_ID }
            });
            if (filesResponse.ok) {
                allFilesData = await filesResponse.json();
                console.log('📂 Got all files in one request');
            }
        } catch (error) {
            console.warn('Could not fetch all files, will use per-folder approach:', error);
        }
        
        // Create folder cards with RANDOM thumbnails from folder songs
        let html = '';
        for (let i = 0; i < folders.length; i++) {
            const folder = folders[i];
            const songCount = folder.file_count || folder.count || 0;
            const folderName = folder.name || 'Unknown';
            
            // Get songs for this folder from the already-fetched allFilesData
            let songs = [];
            if (allFilesData && allFilesData.folders && allFilesData.folders[folderName]) {
                songs = allFilesData.folders[folderName];
            } else if (allFilesData && allFilesData.files) {
                songs = allFilesData.files.filter(f => (f.folder || '') === folderName);
            }
            
            // If we don't have songs from batch request, they'll be loaded on demand when folder is clicked
            let thumbnail = '';
            let songsAll = songs;
            let songsWithThumbnails = [];
            
            if (songs && songs.length > 0) {
                // Derive thumbnails when possible: if no `thumbnail` but `source_url` contains a YouTube link,
                // construct the standard YouTube thumbnail URL.
                songs = songs.map(s => {
                    if (!s) return s;
                    if (!s.thumbnail) {
                        const src = s.source_url || s.url || '';
                        try {
                            const m = src.match(/(?:v=|youtu\.be\/|\/vi\/|\/embed\/)([A-Za-z0-9_-]{6,})/);
                            if (m && m[1]) {
                                s.thumbnail = `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
                                s._derived_thumbnail = true;
                            }
                        } catch (e) {}
                    }
                    return s;
                });

                // Filter songs with thumbnails
                songsWithThumbnails = songs.filter(song => song && (song.thumbnail || song.thumbnail_url || song.thumb));
                
                if (songsWithThumbnails.length > 0) {
                    // Pick a random song thumbnail each time (so it changes on refresh)
                    const randomSong = songsWithThumbnails[Math.floor(Math.random() * songsWithThumbnails.length)];
                    const baseThumb = randomSong.thumbnail || randomSong.thumbnail_url || randomSong.thumb || '';
                    const cacheBuster = `t=${Date.now()}`;
                    thumbnail = baseThumb ? (baseThumb.includes('?') ? `${baseThumb}&${cacheBuster}` : `${baseThumb}?${cacheBuster}`) : '';
                    console.debug('Selected thumbnail for', folderName, thumbnail);
                }
            }
            
            // Build song initials list (max 9) for fallback collage
            let songInitials = '';
            try {
                if (songs && songs.length > 0) {
                    songInitials = songs.slice(0,9).map(s => {
                        const name = (s.display_name || s.title || s.filename || '').toString().trim();
                        return (name.substring(0,2) || name.substring(0,1) || '').toUpperCase();
                    }).join('|');
                }
            } catch(e) { songInitials = ''; }

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
            // We'll render an initials-collage immediately for responsiveness,
            // and attempt to swap in a real thumbnail collage asynchronously
            // if proxied thumbnails load successfully.
            let collageHtml = '';
            let proxyUrlsForCard = [];

            // Prepare collageHtml and proxy url list when thumbnails are available
            // ONLY show collage if folder has 9+ songs; otherwise show initials
            // Use cached thumbnail if available so users see covers immediately
            try {
                const cached = getCachedThumb(folderName);
                if (cached) {
                    let cachedCollageHtml = '';
                    const cachedProxy = cached.proxyUrls || [];
                    if (cached.type === 'server' && cached.url) {
                        cachedCollageHtml = `<img class="folder-thumb-img" src="${cached.url}" alt="${folderName} collage">`;
                    } else if (cached.type === 'client' && cached.html) {
                        cachedCollageHtml = cached.html;
                    } else if (cached.html) {
                        cachedCollageHtml = cached.html;
                    }
                    if (cachedCollageHtml) {
                        collageHtml = cachedCollageHtml;
                        proxyUrlsForCard = cachedProxy.slice();
                        thumbnailContent = collageHtml;
                        console.log('Using cached thumbnail for', folderName);
                    }
                }
            } catch (e) { /* ignore cache errors */ }
            if (thumbnail && !FORCE_INITIALS_COLLAGE && songCount >= 9) {
                // Use random song thumbnail (cache-busted)
                // Keep the original URL but escape double-quotes for safety in attribute
                const safeAttrUrl = thumbnail.replace(/\"/g, '%22');
                // Log chosen thumbnail for debugging
                console.log('Folder thumbnail chosen for', folderName, ':', safeAttrUrl);

                // If multiple thumbnails exist, create a 3x3 collage (up to 9 images)
                    const maxCollage = 9;
                    // Build a list of up to `maxCollage` thumbnail sources, duplicating when necessary
                    const baseThumbs = songsWithThumbnails.slice(0, maxCollage).map(s => {
                        const t = s.thumbnail || '';
                        const tb = t.includes('?') ? `${t}&t=${Date.now()}` : `${t}?t=${Date.now()}`;
                        const proxy = withClientId(`${API_BASE}/thumbnail?url=${encodeURIComponent(tb)}`);
                        return { proxy, tb };
                    }).filter(Boolean);

                    // If we have at least one thumbnail, duplicate to fill the 3x3 grid
                    const sources = [];
                    if (baseThumbs.length > 0) {
                        for (let i = 0; i < maxCollage; i++) {
                            const src = baseThumbs[i % baseThumbs.length];
                            proxyUrlsForCard.push(src.proxy);
                            sources.push(src);
                        }
                    }

                    const collageImgs = sources.map(s => {
                        console.log('Using proxied thumbnail URL for collage:', s.proxy);
                        return `<img class="folder-collage-img" src="${s.proxy}" onerror="this.style.display='none'" data-orig="${s.tb}">`;
                    });

                // Use server-side collage endpoint (single image) to reduce requests
                    try {
                    const collageUrl = withClientId(`${API_BASE}/folder_collage?folder=${encodeURIComponent(folderName)}`);
                    // Try server-generated collage first so the full 3x3 image is preferred
                    proxyUrlsForCard.unshift(collageUrl);
                    collageHtml = `<img class=\"folder-thumb-img\" src=\"${collageUrl}\" alt=\"${folderName} collage\">`;
                    thumbnailContent = ''; // show initials immediately while we prefetch
                } catch (e) {
                    // fallback to client-side collage if server endpoint unavailable
                    const extra = songsWithThumbnails.length - maxCollage;
                    const extraBadge = extra > 0 ? `<div class=\"collage-count\">+${extra}</div>` : '';
                    thumbnailStyle = '';
                    collageHtml = `<div class=\"folder-collage\">${collageImgs.join('')} ${extraBadge}</div>`;
                    thumbnailContent = '';
                }
            } else {
                // Force initials-collage (or no thumbnail available)
                thumbnailStyle = '';
                // Build initials collage from songInitials (up to 9)
                const initialsArr = (songInitials || '').split('|').filter(Boolean);
                    if (initialsArr.length > 0) {
                    const colors = ['#FF6B6B','#4ECDC4','#45B7D1','#FFA07A','#98D8C8','#F7DC6F','#BB8FCE','#85C1E2','#F8B88B','#52C41A'];
                    const cells = initialsArr.slice(0,9).map((ini, idx) => {
                        const color = colors[(ini.charCodeAt(0)||idx) % colors.length];
                        const text = (ini || initials).toUpperCase();
                        return `<div class="initial-cell" style="background:${color};">${text}</div>`;
                    }).join('');
                    thumbnailContent = `<div class="initials-collage">${cells}</div>`;
                } else {
                    thumbnailContent = `<div class="folder-initials" style="background:${bgColor};">${initials}</div>`;
                }
            }
            // Attach collageHtml and proxy URL list as data attributes so
            // we can attempt an async swap after inserting into the DOM.
            const encodedCollage = collageHtml ? encodeURIComponent(collageHtml) : '';
            const encodedProxyUrls = proxyUrlsForCard.length ? encodeURIComponent(JSON.stringify(proxyUrlsForCard)) : '';

            html += `
                <div class="folder-card" style="position:relative;" data-song-inits="${songInitials}" onclick="showFolderSongs('${escapedName}', ${songCount})" title="${folderName}">
                    <div class="folder-thumbnail" style="${thumbnailStyle}" data-collage-html="${encodedCollage}" data-proxy-urls="${encodedProxyUrls}">
                        ${thumbnailContent}
                        <div class="folder-count-badge">${songCount} song${songCount !== 1 ? 's' : ''}</div>
                    </div>
                    <div class="folder-info" style="position:absolute;left:12px;right:12px;bottom:12px;z-index:1000;background:rgba(0,0,0,0.32);padding:6px 8px;border-radius:8px;text-align:center;">
                        <div class="folder-name" style="color:#fff;font-weight:800;">${folderName}</div>
                    </div>
                </div>
            `;
        }
        
        foldersContainer.innerHTML = html;
        console.log('✅ Folder cards loaded with random thumbnails');

        // Add CSS for folder cards if not already present
        addFolderCardStyles();

        // Enforce inline styles with !important to override any stylesheet !important rules
        // This ensures folder-info overlay (name) remains visible on mobile browsers
        setTimeout(() => {
            try {
                const cards = document.querySelectorAll('.folder-card');
                cards.forEach(card => {
                    card.style.setProperty('position', 'relative', 'important');
                    const info = card.querySelector('.folder-info');
                    if (info) {
                        info.style.setProperty('position', 'absolute', 'important');
                        info.style.setProperty('left', '12px', 'important');
                        info.style.setProperty('right', '12px', 'important');
                        info.style.setProperty('bottom', '12px', 'important');
                        info.style.setProperty('z-index', '10000', 'important');
                        info.style.setProperty('background', 'rgba(0,0,0,0.42)', 'important');
                        info.style.setProperty('padding', '6px 8px', 'important');
                        info.style.setProperty('border-radius', '8px', 'important');
                        info.style.setProperty('text-align', 'center', 'important');
                        const name = info.querySelector('.folder-name');
                        if (name) {
                            name.style.setProperty('color', '#fff', 'important');
                            name.style.setProperty('font-weight', '800', 'important');
                            name.style.setProperty('font-size', '14px', 'important');
                        }
                    }
                });
            } catch (e) { console.warn('Failed to enforce inline folder-info styles', e); }
        }, 60);
        // Try to swap initials -> real collage asynchronously when proxies load
        trySwapCollageThumbnails();
        // Also verify images loaded later and fallback if necessary
        setTimeout(verifyFolderImages, 1200);
        
    } catch (error) {
        console.error('❌ Error loading folders:', error);
        // Attempt fallback: render cached thumbnails / folder names from local cache so UI isn't empty
        try {
            const cache = loadFolderThumbCache();
            const names = Object.keys(cache || {});
            if (names.length > 0) {
                let fallbackHtml = '';
                names.forEach(n => {
                    const entry = cache[n] || {};
                    const songCount = entry.count || 0;
                    const folderName = n;
                    let thumbHtml = '';
                    if (entry.type === 'server' && entry.url) {
                        thumbHtml = `<img class="folder-thumb-img" src="${entry.url}" alt="${folderName} collage">`;
                    } else if (entry.type === 'client' && entry.html) {
                        thumbHtml = entry.html;
                    } else {
                        const initials = folderName.substring(0,2).toUpperCase();
                        thumbHtml = `<div class="folder-initials" style="background:#556B2F;">${initials}</div>`;
                    }
                    fallbackHtml += `
                        <div class="folder-card" onclick="showFolderSongs('${folderName}', ${songCount})" title="${folderName}">
                            <div class="folder-thumbnail">${thumbHtml}<div class="folder-count-badge">${songCount} song${songCount !== 1 ? 's' : ''}</div></div>
                            <div class="folder-info"><div class="folder-name">${folderName}</div></div>
                        </div>
                    `;
                });
                foldersContainer.innerHTML = fallbackHtml;
                addFolderCardStyles();
                // Inform user visually that cached data is used
                showDebugOverlay('Using cached folder thumbnails — API unavailable', 'warn');
                // attempt to swap collages if any proxy URLs exist
                trySwapCollageThumbnails();
                return;
            }
        } catch (e) {
            console.warn('Failed to render cached folders', e);
        }

        foldersContainer.innerHTML = `<p style="text-align:center; color: var(--danger); padding: 40px 20px;">Error loading playlists: ${error.message}</p>`;
    }
}

// Verify folder collage images loaded; fallback to initials if all images failed
function verifyFolderImages() {
    try {
        const folderCards = document.querySelectorAll('.folder-card');
        folderCards.forEach(card => {
            const collage = card.querySelector('.folder-collage');
            const singleImg = card.querySelector('.folder-thumb-img');
            let loadedCount = 0;
            let total = 0;

            if (collage) {
                const imgs = Array.from(collage.querySelectorAll('img'));
                total = imgs.length;
                imgs.forEach(img => {
                    // If image already failed (display:none) or naturalWidth is 0, treat as failed
                    if (img.complete && img.naturalWidth > 0) loadedCount++;
                    else {
                        // attach load/error handlers to update later
                        img.addEventListener('load', () => { img.style.display = 'block'; });
                        img.addEventListener('error', () => { img.style.display = 'none'; });
                    }
                });

                // After a short delay check again
                setTimeout(() => {
                    const imgs2 = Array.from(collage.querySelectorAll('img'));
                    const success = imgs2.some(i => i.complete && i.naturalWidth > 0 && i.style.display !== 'none');
                    if (!success) {
                        console.warn('Folder collage images failed to load, applying initials-collage fallback for', card);
                        const nameEl = card.querySelector('.folder-name');
                        const name = nameEl ? nameEl.textContent.trim() : 'Album';
                        const initialsData = (card.dataset.songInits || '').split('|').filter(Boolean);
                        const colors = ['#FF6B6B','#4ECDC4','#45B7D1','#FFA07A','#98D8C8','#F7DC6F','#BB8FCE','#85C1E2','#F8B88B','#52C41A'];
                        const thumb = card.querySelector('.folder-thumbnail');
                        if (thumb) {
                            if (initialsData.length > 0) {
                                // Build grid of initials
                                const cells = initialsData.map((ini, idx) => {
                                    const color = colors[(ini.charCodeAt(0)||idx) % colors.length];
                                    const text = (ini || name.substring(0,2)).toUpperCase();
                                    return `<div class="initial-cell" style="background:${color};">${text}</div>`;
                                }).join('');
                                thumb.innerHTML = `<div class="initials-collage">${cells}</div>`;
                            } else {
                                const color = colors[(name.charCodeAt(0)||0) % colors.length];
                                const initials = name.substring(0,2).toUpperCase();
                                thumb.innerHTML = `<div class="folder-initials" style="background:${color};width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:20px;">${initials}</div>`;
                            }
                        }
                    }
                }, 600);
            } else if (singleImg) {
                total = 1;
                const img = singleImg;
                if (img.complete && img.naturalWidth > 0) loadedCount = 1;
                else {
                    img.addEventListener('load', () => {});
                    img.addEventListener('error', () => {
                        const nameEl = card.querySelector('.folder-name');
                        const name = nameEl ? nameEl.textContent.trim() : 'Album';
                        const initialsData = (card.dataset.songInits || '').split('|').filter(Boolean);
                        const colors = ['#FF6B6B','#4ECDC4','#45B7D1','#FFA07A','#98D8C8','#F7DC6F','#BB8FCE','#85C1E2','#F8B88B','#52C41A'];
                        const thumb = card.querySelector('.folder-thumbnail');
                        if (thumb) {
                            if (initialsData.length > 0) {
                                const cells = initialsData.map((ini, idx) => {
                                    const color = colors[(ini.charCodeAt(0)||idx) % colors.length];
                                    const text = (ini || name.substring(0,2)).toUpperCase();
                                    return `<div class="initial-cell" style="background:${color};">${text}</div>`;
                                }).join('');
                                thumb.innerHTML = `<div class="initials-collage">${cells}</div>`;
                            } else {
                                const color = colors[(name.charCodeAt(0)||0) % colors.length];
                                const initials = name.substring(0,2).toUpperCase();
                                thumb.innerHTML = `<div class="folder-initials" style="background:${color};width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:20px;">${initials}</div>`;
                            }
                        }
                    });
                }
                // Additional check: if singleImg is present but very small relative to thumbnail container,
                // assume server returned a small single-thumb image and replace with client collage from proxies.
                try {
                    if (singleImg && singleImg.complete && singleImg.naturalWidth > 0) {
                        const thumb = card.querySelector('.folder-thumbnail');
                        if (thumb) {
                            const cw = thumb.clientWidth || thumb.offsetWidth || 1;
                            const ch = thumb.clientHeight || thumb.offsetHeight || 1;
                            // If image occupies less than 40% of container width/height, replace
                            if (singleImg.naturalWidth < cw * 0.4 || singleImg.naturalHeight < ch * 0.4) {
                                const proxyUrlsEnc = thumb.dataset.proxyUrls || '';
                                if (proxyUrlsEnc) {
                                    const proxyUrls = JSON.parse(decodeURIComponent(proxyUrlsEnc));
                                    if (proxyUrls && proxyUrls.length > 0) {
                                        // Build client collage from first up to 9 proxies
                                        const imgs = proxyUrls.slice(0,9).map(p => `<img class=\"folder-collage-img\" src=\"${p}\" onerror=\"this.style.display='none'\">`).join('');
                                        const extra = Math.max(0, proxyUrls.length - 9);
                                        const extraBadge = extra > 0 ? `<div class=\"collage-count\">+${extra}</div>` : '';
                                        thumb.innerHTML = `<div class=\"folder-collage\">${imgs}</div>${extraBadge}` + (thumb.querySelector('.folder-count-badge') ? thumb.querySelector('.folder-count-badge').outerHTML : '');
                                        setTimeout(() => verifyFolderImages(), 600);
                                    }
                                }
                            }
                        }
                    }
                } catch (e) { console.warn('verifyFolderImages collage fallback error', e); }
            }
        });
    } catch (e) {
        console.error('verifyFolderImages error', e);
    }
}

// Attempt to load proxied thumbnails in the background and swap in the collage
function trySwapCollageThumbnails() {
    const folderCards = document.querySelectorAll('.folder-card');
    folderCards.forEach(card => {
        try {
            const thumbEl = card.querySelector('.folder-thumbnail');
            const collageHtmlEnc = thumbEl?.dataset?.collageHtml || '';
            const proxyUrlsEnc = thumbEl?.dataset?.proxyUrls || '';
            if (!collageHtmlEnc || !proxyUrlsEnc || !thumbEl) return;
            const collageHtml = decodeURIComponent(collageHtmlEnc);
            const proxyUrls = JSON.parse(decodeURIComponent(proxyUrlsEnc));
            if (!proxyUrls || proxyUrls.length === 0) return;

            // If we already rendered a cached collage into the thumbnail during render, skip attempting swaps
            if (thumbEl.querySelector('.folder-collage') || thumbEl.querySelector('img.folder-thumb-img')) return;

            // Try up to first 3 proxy URLs to warm caches and find a working image
            const tryUrls = proxyUrls.slice(0, 3);
            (async () => {
                for (const u of tryUrls) {
                    try {
                        const ok = await fetchWithTimeout(u, 2500);
                        if (!ok) continue;

                        const badge = thumbEl.querySelector('.folder-count-badge');
                        const badgeHtml = badge ? badge.outerHTML : '';

                        // Prefer server-generated collage when available
                        if (u.includes('/folder_collage')) {
                            try {
                                const resp = await fetch(u, { method: 'GET', credentials: 'same-origin' });
                                if (!resp.ok) throw new Error('collage fetch failed');
                                const blob = await resp.blob();
                                const minSize = 3 * 1024;
                                if (blob.size && blob.size >= minSize) {
                                    const folderName = card.querySelector('.folder-name')?.textContent.trim() || '';
                                    thumbEl.innerHTML = `<img class="folder-thumb-img" src="${u}" alt="${folderName} collage">` + badgeHtml;
                                    setTimeout(() => verifyFolderImages(), 600);
                                    try { saveFolderThumbCache(folderName, { type: 'server', url: u, proxyUrls: proxyUrls }); } catch(e){}
                                    console.log('Replaced initials with server collage for', folderName);
                                    break;
                                } else {
                                    continue;
                                }
                            } catch (e) {
                                continue;
                            }
                        }

                        // Otherwise build a client-side collage from proxied images
                        try {
                            const imgs = proxyUrls.slice(0, 9).map(p => `<img class="folder-collage-img" src="${p}" onerror="this.style.display='none'">`).join('');
                            const extra = Math.max(0, proxyUrls.length - 9);
                            const extraBadge = extra > 0 ? `<div class="collage-count">+${extra}</div>` : '';
                            const folderName = card.querySelector('.folder-name')?.textContent.trim() || '';
                            const newHtml = `<div class="folder-collage">${imgs}</div>${extraBadge}` + badgeHtml;
                            thumbEl.innerHTML = newHtml;
                            setTimeout(() => verifyFolderImages(), 600);
                            try { saveFolderThumbCache(folderName, { type: 'client', html: newHtml, proxyUrls: proxyUrls }); } catch(e){}
                            console.log('Replaced initials with client collage for', folderName);
                            break;
                        } catch (e) {
                            continue;
                        }
                    } catch (e) {
                        // ignore and try next url
                        continue;
                    }
                }
            })();
        } catch (e) {
            // ignore per-card errors
        }
    });
}

function loadImageWithTimeout(url, timeout = 2000) {
    return new Promise((resolve, reject) => {
        try {
            const img = new Image();
            let settled = false;
            const t = setTimeout(() => {
                if (!settled) { settled = true; img.src = ''; reject(new Error('timeout')); }
            }, timeout);
            img.onload = () => { if (!settled) { settled = true; clearTimeout(t); resolve(true); } };
            img.onerror = () => { if (!settled) { settled = true; clearTimeout(t); reject(new Error('error')); } };
            img.src = url;
        } catch (e) { reject(e); }
    });
}

// Fetch a URL with timeout and check Content-Type is image/* and response.ok
function fetchWithTimeout(url, timeout = 2500) {
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        fetch(url, { method: 'GET', signal: controller.signal, credentials: 'same-origin' })
            .then(resp => {
                clearTimeout(id);
                if (!resp.ok) return resolve(false);
                const ct = resp.headers.get('content-type') || '';
                if (ct.startsWith('image/')) return resolve(true);
                // Some proxies may not set content-type correctly; attempt to read small blob
                return resp.blob().then(b => {
                    const isImg = b && b.type && b.type.startsWith('image/');
                    resolve(isImg);
                }).catch(() => resolve(false));
            })
            .catch(err => {
                clearTimeout(id);
                resolve(false);
            });
    });
}

// Add refresh functionality for folder thumbnails
function refreshFolderThumbnails() {
    console.log('🔄 Refreshing folder thumbnails...');
    
    // Add cache busting parameter
    const cacheBuster = `?t=${Date.now()}&client_id=${encodeURIComponent(CLIENT_ID)}`;
    
    // Show loading indicator
    const foldersContainer = document.getElementById('foldersContainer');
    if (foldersContainer) {
        const originalContent = foldersContainer.innerHTML;
        foldersContainer.innerHTML = '<div class="loading-spinner">Refreshing thumbnails...</div>';
        
        // Reload after a short delay
        setTimeout(() => {
            loadFolderCards();
        }, 500);
    }
}

// Add refresh button to user dashboard
function addRefreshThumbnailButton() {
    const header = document.querySelector('.user-header') || document.querySelector('header');
    if (!header) return;
    
    // Check if refresh button already exists
    if (document.getElementById('refreshThumbnailsBtn')) return;
    
    const refreshBtn = document.createElement('button');
    refreshBtn.id = 'refreshThumbnailsBtn';
    
    refreshBtn.style.cssText = `
        background: var(--primary-color);
        color: white;
        border: none;
        padding: 8px 15px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        margin-left: 10px;
    `;
    refreshBtn.title = 'Refresh folder thumbnails with new random song covers';
    
    refreshBtn.addEventListener('click', refreshFolderThumbnails);
    
    // Add to header
    header.appendChild(refreshBtn);
}

// Auto-refresh thumbnails on page load
function autoRefreshThumbnails() {
    // Refresh thumbnails after 1 second
    setTimeout(() => {
        console.log('🔄 Auto-refreshing thumbnails on page load...');
        refreshFolderThumbnails();
    }, 1000);
}

// Add CSS styles for folder cards - MOBILE OPTIMIZED
function addFolderCardStyles() {
    if (document.getElementById('folder-card-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'folder-card-styles';
    style.textContent = `
        .folders-grid, .folders-container {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 15px;
            padding: 15px;
        }
        
        .folder-card {
            /* use themed card background so cards stand out against page */
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
            position: relative; /* allow absolute overlay of folder-info */
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
            width: 100%;
            box-sizing: border-box;
            /* subtle lifted surface so thumbnail grid is visible on dark theme */
            background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.06));
            border-bottom: 1px solid rgba(255,255,255,0.03);
        }
        .folder-thumbnail img.folder-thumb-img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
        /* Collage grid for multiple thumbnails */
        .folder-collage {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            grid-auto-rows: 1fr;
            gap: 2px;
            width: 100%;
            height: 100%;
            position: relative;
        }
        .folder-collage-img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
            border-radius: 2px;
            box-shadow: inset 0 0 0 1px rgba(0,0,0,0.08);
        }
        .initials-collage {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 2px;
            width: 100%;
            height: 100%;
            grid-auto-rows: 1fr;
            align-items: stretch;
        }
        .initial-cell {
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            font-weight: 800;
            font-size: 16px;
            text-shadow: 0 1px 2px rgba(0,0,0,0.4);
            min-height: 0;
            height: 100%;
            width: 100%;
        }
        .collage-count {
            position: absolute;
            right: 6px;
            top: 6px;
            background: rgba(30,30,30,0.9);
            color: #fff;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 12px;
            z-index: 2;
            box-shadow: 0 2px 6px rgba(0,0,0,0.5);
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
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            white-space: normal;
            word-break: break-word;
            text-align: center;
            font-size: 14px;
            width: 100%;
            line-height: 1.2;
            max-height: 2.6em; /* keep card height stable */
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
            .folders-grid, .folders-container {
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
            .folders-grid, .folders-container {
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
        /* FORCE: Ensure folder names are visible on touch/mobile devices */
        @media (max-width: 900px) {
            .folders-grid .folder-info, .folders-container .folder-info { display: block !important; position: relative !important; z-index: 60 !important; padding-top: 6px !important; }
            .folders-grid .folder-name, .folders-container .folder-name { display: block !important; color: #ffffff !important; background: rgba(0,0,0,0.32) !important; padding: 6px 8px !important; border-radius: 8px !important; margin: 6px auto 0 auto !important; max-width: 95% !important; text-align: center !important; overflow: hidden !important; text-overflow: ellipsis !important; }
            .folders-grid .folder-thumbnail::after, .folders-container .folder-thumbnail::after { height: 36px !important; bottom: 0 !important; z-index: 5 !important; pointer-events: none !important; }
        }

        /* Absolute overlay: ensure folder-name is visible on top of thumbnails */
        .folders-grid .folder-card, .folders-container .folder-card { position: relative; }
        .folders-grid .folder-info, .folders-container .folder-info { position: absolute !important; left: 12px !important; right: 12px !important; bottom: 12px !important; z-index: 1000 !important; background: rgba(0,0,0,0.32) !important; padding: 6px 8px !important; border-radius: 8px !important; text-align: center !important; }
        .folders-grid .folder-name, .folders-container .folder-name { color: #fff !important; font-weight: 800 !important; }
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

        // If we have cached songs for this folder, render them immediately to reduce wait
        try {
            const cached = getCachedFolderSongs(folderName);
            if (cached && Array.isArray(cached) && cached.length > 0) {
                // show cached list immediately and mark as updating
                songsContainer.innerHTML = buildSongCardsHtml(cached);
                const updating = document.createElement('div');
                updating.className = 'songs-updating-banner';
                updating.style.cssText = 'text-align:center;color:var(--text-secondary);padding:6px 0;font-size:13px;';
                updating.textContent = 'Updating playlist in background...';
                if (songsSection) songsSection.insertBefore(updating, songsSection.firstChild);
            }
        } catch (e) { console.warn('Error rendering cached songs', e); }
        
        // Hide folders, show songs
        if (foldersSection) foldersSection.style.display = 'none';
        songsSection.style.display = 'block';
        
        // Fetch songs in folder with cache buster
        const cacheBuster = `&t=${Date.now()}`;
        const response = await fetch(withClientId(`${API_BASE}/files?folder=${encodeURIComponent(folderName)}${cacheBuster}`), {
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
            // clear any cached songs for this folder
            try { saveCachedFolderSongs(folderName, []); } catch(e){}
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
        
        // Render fresh songs and replace any cached content
        try {
            const freshHtml = buildSongCardsHtml(songs);
            songsContainer.innerHTML = freshHtml;
            // save to cache for next time
            try { saveCachedFolderSongs(folderName, songs); } catch(e){}
            // remove any updating banner if present
            const banner = document.querySelector('.songs-updating-banner'); if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
        } catch (e) {
            console.warn('Error rendering fresh songs', e);
        }
        
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
    
    // Add refresh thumbnail button
    addRefreshThumbnailButton();
}

// Auto-refresh thumbnails when page loads
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        autoRefreshThumbnails();
    }, 2000);
});

// Export new user dashboard functions to global scope
window.loadFolderCards = loadFolderCards;
window.showFolderSongs = showFolderSongs;
window.playSongFromFolder = playSongFromFolder;
window.backToFolders = backToFolders;
window.playAllCurrentFolder = playAllCurrentFolder;
window.refreshFolderThumbnails = refreshFolderThumbnails;
window.attachUserDashboardListeners = attachUserDashboardListeners;

// ============================================
// PWA: Service Worker Registration & Install
// ============================================

// Register service worker on load
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then((reg) => {
        console.log('✅ Service Worker registered');
        
        // Periodic update check
        setInterval(() => {
          reg.update();
        }, 60000);
      })
      .catch((err) => {
        console.warn('Service Worker registration failed:', err);
      });
  });
}

// PWA Install Prompt Handler
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  console.log('✅ beforeinstallprompt event captured');
  showAllInstallButtons();
});

// Show all install buttons
function showAllInstallButtons() {
  const buttons = [
    document.getElementById('installButton'),
    document.getElementById('installButton2')
  ];
  
  buttons.forEach((btn) => {
    if (btn) {
      btn.style.display = 'block';
      console.log('✅ Showing install button:', btn.id);
    }
  });
}

// Attach click handlers to all install buttons
function attachInstallHandlers() {
  const buttons = [
    document.getElementById('installButton'),
    document.getElementById('installButton2')
  ];
  
  buttons.forEach((btn) => {
    if (btn && !btn.hasAttribute('data-listener-attached')) {
      btn.addEventListener('click', promptInstall);
      btn.setAttribute('data-listener-attached', 'true');
      console.log('✅ Attached install handler to:', btn.id);
    }
  });
}

// Handle install prompt
async function promptInstall() {
  if (!deferredPrompt) {
    console.warn('Install prompt not available');
    return;
  }
  
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  
  console.log(`📱 User response to install prompt: ${outcome}`);
  
  if (outcome === 'accepted') {
    console.log('✅ App installed!');
    deferredPrompt = null;
    hideAllInstallButtons();
  }
}

// Hide all install buttons
function hideAllInstallButtons() {
  const buttons = [
    document.getElementById('installButton'),
    document.getElementById('installButton2')
  ];
  
  buttons.forEach((btn) => {
    if (btn) {
      btn.style.display = 'none';
    }
  });
}

// Listen for app installed
window.addEventListener('appinstalled', () => {
  console.log('✅ PWA app installed successfully!');
  hideAllInstallButtons();
});

// Attach install handlers when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  attachInstallHandlers();
  
  // If already have deferred prompt, show buttons
  if (deferredPrompt) {
    showAllInstallButtons();
  }
});

// Also try attaching immediately
attachInstallHandlers();
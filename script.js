const API_BASE = 'http://localhost:5000/api';

let currentFileId = null;
let statusCheckInterval = null;

const form = document.getElementById('convertForm');
const urlInput = document.getElementById('youtubeUrl');
const convertBtn = document.getElementById('convertBtn');
const folderSelect = document.getElementById('folderSelect');
const newFolderBtn = document.getElementById('newFolderBtn');
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
// Tracks whether the user explicitly stopped playback
window._yt_userStopped = false;

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const url = urlInput.value.trim();
    const folder = folderSelect.value || null;
    const bitrate = document.getElementById('bitrateSelect').value || '64';
    
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
        const response = await fetch(`${API_BASE}/convert`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url, folder, bitrate }),
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Conversion failed');
        }
        
        currentFileId = data.file_id;
        showProgress();
        startStatusCheck();
        
    } catch (error) {
        showError(error.message || 'Failed to start conversion. Make sure the server is running.');
        resetButton();
    }
});

function startStatusCheck() {
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
    }
    
    statusCheckInterval = setInterval(async () => {
        if (!currentFileId) return;
        
        try {
            const response = await fetch(`${API_BASE}/status/${currentFileId}`);
            const data = await response.json();
            
            if (data.status === 'completed') {
                clearInterval(statusCheckInterval);
                showDownload(data.filename, data.title);
                resetButton();
            } else if (data.status === 'error') {
                clearInterval(statusCheckInterval);
                showError(data.message || 'Conversion failed');
                resetButton();
            } else {
                // Still processing
                updateProgress();
            }
        } catch (error) {
            console.error('Status check error:', error);
        }
    }, 2000); // Check every 2 seconds
}

function updateProgress() {
    // Simulate progress animation
    const currentWidth = parseInt(progressFill.style.width) || 0;
    if (currentWidth < 90) {
        progressFill.style.width = (currentWidth + 10) + '%';
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
        window.location.href = `${API_BASE}/download/${currentFileId}`;
        
        // Clean up after download
        setTimeout(() => {
            fetch(`${API_BASE}/cleanup/${currentFileId}`, {
                method: 'DELETE'
            }).catch(console.error);
            
            // Reset UI after a delay
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

// Register service worker for notifications and background controls
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
window.addEventListener('DOMContentLoaded', () => {
    loadLibrary();
    loadFolders();
    // Try to restore playback state (auto-resume if it wasn't an explicit stop)
    restorePlaybackState();
});

refreshBtn.addEventListener('click', () => {
    loadLibrary();
});

closePlayer.addEventListener('click', () => {
    playerModal.style.display = 'none';
    audioPlayer.pause();
    audioPlayer.src = '';
    // Keep the player minimized when closed
    // Mark this as an explicit user stop so we don't auto-resume after reload
    window._yt_userStopped = true;
    savePlaybackState();
    setTimeout(() => {
        playerModal.classList.add('minimized');
    }, 300);
});

// Rewind 10 seconds
rewindBtn.addEventListener('click', () => {
    audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 10);
});

// Skip 10 seconds
skipBtn.addEventListener('click', () => {
    audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 10);
});

// Close modal when clicking outside
playerModal.addEventListener('click', (e) => {
    if (e.target === playerModal) {
        playerModal.style.display = 'none';
        // Explicit close -> treat as user stop
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
        const url = folderFilter 
            ? `${API_BASE}/files?folder=${encodeURIComponent(folderFilter)}`
            : `${API_BASE}/files`;
        const response = await fetch(url);
        const data = await response.json();
        
        libraryLoading.style.display = 'none';
        
        let files = [];
        if (folderFilter) {
            // Filtered view - only show files from this folder
            files = data.files || [];
        } else {
            // All files view - combine root and all folders
            files = data.root || [];
            if (data.folders) {
                Object.values(data.folders).forEach(folderFiles => {
                    files = files.concat(folderFiles);
                });
            }
            // Sort by modified time
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
    
    // Generate a color based on file name (consistent for same files)
    const colors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
        '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B88B', '#52C41A'
    ];
    const colorIndex = file.display_name.charCodeAt(0) % colors.length;
    const bgColor = colors[colorIndex];
    
    // Extract initials from filename
    const initials = file.display_name.split(' ')[0].substring(0, 2).toUpperCase();
    
    const folderLabel = file.folder ? `<span class="card-folder-badge">${escapeHtml(file.folder)}</span>` : '';
    
    // Use thumbnail if available, otherwise use gradient background with initials
    const thumbnailStyle = file.thumbnail 
        ? `background-image: url('${file.thumbnail}'); background-size: cover; background-position: center;`
        : `background: linear-gradient(135deg, ${bgColor} 0%, ${adjustBrightness(bgColor, -30)} 100%);`;
    
    const thumbnailContent = file.thumbnail 
        ? ''  // Don't show initials if we have a real thumbnail
        : `<div class="card-initials">${initials}</div>`;
    
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
            <button class="card-action-btn play-btn" data-url="${file.url}" data-name="${escapeHtml(file.display_name)}" title="Play">
                ▶️
            </button>
            <button class="card-action-btn download-file-btn" data-filename="${file.filename}" data-folder="${file.folder || ''}" title="Download">
                ⬇️
            </button>
            <button class="card-action-btn delete-btn" data-filename="${file.filename}" data-folder="${file.folder || ''}" title="Delete">
                🗑️
            </button>
        </div>
    `;
    
    // Add event listeners
    const playBtn = item.querySelector('.play-btn');
    const downloadBtn = item.querySelector('.download-file-btn');
    const deleteBtn = item.querySelector('.delete-btn');
    
    playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = playBtn.dataset.url.startsWith('/') 
            ? `http://localhost:5000${playBtn.dataset.url}`
            : `${API_BASE}/${playBtn.dataset.url}`;
        playAudio(url, playBtn.dataset.name);
    });
    
    downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const filename = downloadBtn.dataset.folder
            ? `${downloadBtn.dataset.folder}/${downloadBtn.dataset.filename}`
            : downloadBtn.dataset.filename;
        window.location.href = `${API_BASE}/download-file/${encodeURIComponent(filename)}`;
    });
    
    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this file?')) {
            const filename = deleteBtn.dataset.folder
                ? `${deleteBtn.dataset.folder}/${deleteBtn.dataset.filename}`
                : deleteBtn.dataset.filename;
            await deleteFile(filename);
        }
    });
    
    return item;
}

// Helper function to adjust color brightness
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

function playAudio(url, name) {
    playerTitle.textContent = name;
    
    // Ensure URL is properly formatted - handle URLs that already start with /api/
    if (!url.startsWith('http')) {
        // If URL already starts with /api/, use localhost directly
        if (url.startsWith('/api/')) {
            url = `http://localhost:5000${url}`;
        } else {
            url = `${API_BASE}${url}`;
        }
    }
    
    console.log('Playing audio from:', url);
    
    // Reset and set source
    audioPlayer.pause();
    audioPlayer.src = '';
    audioPlayer.load();
    
    // Set new source
    audioPlayer.src = url;
    playerModal.style.display = 'block';
    playerModal.classList.remove('minimized');
    
    // Add event listeners for debugging
    audioPlayer.addEventListener('error', (e) => {
        console.error('Audio error:', e);
        console.error('Error code:', audioPlayer.error?.code);
        console.error('Error message:', audioPlayer.error?.message);
        
        let errorMsg = 'Error playing audio. ';
        if (audioPlayer.error) {
            switch(audioPlayer.error.code) {
                case 1: errorMsg += 'The download was aborted.'; break;
                case 2: errorMsg += 'Network error occurred.'; break;
                case 3: errorMsg += 'The audio file is corrupted or format not supported.'; break;
                case 4: errorMsg += 'The audio source could not be decoded.'; break;
                default: errorMsg += 'Unknown error occurred.';
            }
        }
        errorMsg += ' Please try downloading the file instead.';
        alert(errorMsg);
    });
    
    audioPlayer.addEventListener('loadeddata', () => {
        console.log('Audio data loaded');
    });
    
    audioPlayer.addEventListener('canplay', () => {
        console.log('Audio can play');
    });
    
    // Try to play with better error handling
    const playPromise = audioPlayer.play();
    
    if (playPromise !== undefined) {
        playPromise.then(() => {
            console.log('Audio playing successfully');
            // Setup Media Session and notification
            try {
                updateMediaSession(name);
                requestNotificationPermission().then(granted => {
                    if (granted && navigator.serviceWorker && navigator.serviceWorker.controller) {
                        navigator.serviceWorker.controller.postMessage({
                            type: 'SHOW_NOW_PLAYING',
                            title: name,
                            artist: '',
                            thumbnail: '',
                            url: url,
                            isPlaying: true
                        });
                    }
                });
            } catch (e) {
                console.warn('Media session/notification setup failed', e);
            }
        }).catch(e => {
            console.error('Error playing audio:', e);
            // Try to load the audio first, then play
            audioPlayer.load();
            setTimeout(() => {
                audioPlayer.play().catch(err => {
                    console.error('Second play attempt failed:', err);
                    alert('Error playing audio. The file may be corrupted or the format is not supported. Please try downloading the file instead.');
                });
            }, 100);
        });
    }
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

// Persist playback state to localStorage so we can resume after refresh
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
    // If the user explicitly stopped, do not auto-resume
    if (st.userStopped) return;
    // If there is a URL and it was playing, attempt to restore
    if (st.url && st.isPlaying) {
        // Use playAudio to set up UI and media session
        playAudio(st.url, st.title || '');
        // After source loads, seek to saved time
        const onCanPlay = () => {
            try { audioPlayer.currentTime = st.currentTime || 0; } catch(e){}
            audioPlayer.removeEventListener('canplay', onCanPlay);
            // Ensure we attempt to play
            audioPlayer.play().catch(()=>{});
        };
        audioPlayer.addEventListener('canplay', onCanPlay);
    } else if (st.url) {
        // If not playing but a URL exists, restore source and currentTime without auto-play
        audioPlayer.src = st.url;
        audioPlayer.addEventListener('loadedmetadata', function once() {
            try { audioPlayer.currentTime = st.currentTime || 0; } catch(e){}
            audioPlayer.removeEventListener('loadedmetadata', once);
        });
    }
}

// Periodically save playback position while playing
let _saveThrottle = 0;
audioPlayer.addEventListener('timeupdate', () => {
    // throttle to once per 2 seconds
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
                navigator.serviceWorker.getRegistration().then(reg => { if (reg && reg.getNotifications) reg.getNotifications({tag:'now-playing'}).then(notifs=> notifs.forEach(n=>n.close())); });
            }
            break;
    }
}

async function deleteFile(filename) {
    try {
        const response = await fetch(`${API_BASE}/delete-file/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            loadFolders();
            loadLibrary(currentFolder || null); // Refresh the list
        } else {
            alert('Error deleting file');
        }
    } catch (error) {
        console.error('Error deleting file:', error);
        alert('Error deleting file');
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

// Refresh library when a new file is downloaded
const originalShowDownload = showDownload;
showDownload = function(filename, title) {
    originalShowDownload(filename, title);
    // Refresh library after a short delay to ensure file is saved
    setTimeout(() => {
        loadFolders();
        loadLibrary(currentFolder || null);
    }, 2000);
};

// Also refresh library periodically to catch new files
setInterval(() => {
    loadFolders();
    loadLibrary(currentFolder || null);
}, 10000); // Refresh every 10 seconds

// Folder management
async function loadFolders() {
    try {
        const response = await fetch(`${API_BASE}/folders`);
        const data = await response.json();

        // Populate folder select
        folderSelect.innerHTML = '<option value="">Root (No folder)</option>';
        folderTabs.innerHTML = '<button class="folder-tab active" data-folder="">All Files</button>';

        if (data.folders && data.folders.length > 0) {
            data.folders.forEach(folder => {
                const opt = document.createElement('option');
                opt.value = folder.name;
                opt.textContent = `${folder.name} (${folder.file_count})`;
                folderSelect.appendChild(opt);

                const tab = document.createElement('button');
                tab.className = 'folder-tab';
                tab.dataset.folder = folder.name;
                tab.textContent = folder.name;
                folderTabs.appendChild(tab);
            });
        }

        // Attach tab click listeners
        Array.from(folderTabs.querySelectorAll('.folder-tab')).forEach(tab => {
            tab.addEventListener('click', () => {
                Array.from(folderTabs.querySelectorAll('.folder-tab')).forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentFolder = tab.dataset.folder || '';
                loadLibrary(currentFolder || null);
            });
        });
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
});

closeFolderModal.addEventListener('click', () => {
    folderModal.style.display = 'none';
});

// Create folder
createFolderBtn.addEventListener('click', async () => {
    const name = newFolderName.value.trim();
    if (!name) {
        alert('Please enter a folder name');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/folders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to create folder');
        }

        folderModal.style.display = 'none';
        loadFolders();
        loadLibrary(currentFolder || null);
        showSuccess('Folder created successfully');
        setTimeout(() => { hideAllMessages(); }, 2000);
    } catch (error) {
        alert(error.message || 'Error creating folder');
    }
});

// Close modal when clicking outside
folderModal.addEventListener('click', (e) => {
    if (e.target === folderModal) {
        folderModal.style.display = 'none';
    }
});


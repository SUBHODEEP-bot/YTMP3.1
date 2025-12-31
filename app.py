from flask import Flask, request, jsonify, send_file, redirect, Response
from flask_cors import CORS
import yt_dlp
import os
import uuid
import threading
import shutil
import requests
from pathlib import Path
from datetime import datetime
import logging
from dotenv import load_dotenv
import time
import json
from werkzeug.utils import secure_filename
import urllib.parse

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

# Supabase Configuration
SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_ANON_KEY')
BUCKET_NAME = "yt-downloads"

# Create directories
DOWNLOADS_DIR = Path('downloads')
DOWNLOADS_DIR.mkdir(exist_ok=True)

# Owner/Admin management
OWNER_FILE = Path('owner_id.txt')
CLIENT_ID_HEADER = 'X-Client-Id'

def get_client_id():
    """Get client ID from request"""
    cid = request.headers.get(CLIENT_ID_HEADER) or request.args.get('client_id')
    if not cid:
        # Generate a random ID for anonymous users
        return f"user_{uuid.uuid4().hex[:8]}"
    cid = ''.join(c for c in str(cid) if c.isalnum() or c in ('-', '_'))
    return cid or f"user_{uuid.uuid4().hex[:8]}"


def get_owner_id():
    """Get the owner/admin ID"""
    if OWNER_FILE.exists():
        try:
            return OWNER_FILE.read_text(encoding='utf-8').strip()
        except:
            return None
    return None

def set_owner_id(client_id):
    """Set the owner/admin ID"""
    try:
        OWNER_FILE.write_text(str(client_id), encoding='utf-8')
        logger.info(f"Owner set to: {client_id}")
        return True
    except Exception as e:
        logger.error(f"Error setting owner: {e}")
        return False

def is_owner(client_id):
    """Check if client is owner/admin"""
    owner_id = get_owner_id()
    if not owner_id:
        # First user becomes owner
        set_owner_id(client_id)
        return True
    return client_id == owner_id

def find_ffmpeg_path():
    ffmpeg_path = shutil.which('ffmpeg')
    if ffmpeg_path:
        return str(Path(ffmpeg_path).parent)
    return None

# --- Database Functions ---
def db_request(method, endpoint, data=None, params=None):
    """Generic DB request function"""
    try:
        if not SUPABASE_URL or not SUPABASE_KEY:
            return None
        
        url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
        headers = {
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
        
        if method == 'GET':
            response = requests.get(url, headers=headers, params=params, timeout=10)
        elif method == 'POST':
            response = requests.post(url, headers=headers, json=data, timeout=10)
        elif method == 'PATCH':
            response = requests.patch(url, headers=headers, json=data, timeout=10)
        elif method == 'DELETE':
            response = requests.delete(url, headers=headers, params=params, timeout=10)
        else:
            return None
        
        if response.status_code in [200, 201, 204]:
            if response.status_code == 204:
                return True
            try:
                return response.json()
            except:
                return response.text
        else:
            logger.error(f"DB {method} failed: {response.status_code} - {response.text}")
            return None
            
    except Exception as e:
        logger.error(f"DB request error: {e}")
        return None

def save_to_db(song_data):
    result = db_request('POST', 'conversions', song_data)
    if result:
        logger.info(f"✅ DB: Saved {song_data['file_id']}")
        return result[0]
    return None

def update_in_db(file_id, update_data):
    result = db_request('PATCH', f'conversions?file_id=eq.{file_id}', update_data)
    return bool(result)

def get_from_db(file_id):
    result = db_request('GET', f'conversions?file_id=eq.{file_id}')
    return result[0] if result else None

def get_all_songs():
    """Get all songs from database (for all users)"""
    result = db_request('GET', 'conversions?status=eq.completed&order=created_at.desc')
    return result if result else []

def get_songs_by_folder(folder_name):
    """Get songs by folder name"""
    if folder_name:
        result = db_request('GET', f'conversions?folder=eq.{folder_name}&status=eq.completed&order=created_at.desc')
    else:
        result = db_request('GET', f'conversions?folder=is.null&status=eq.completed&order=created_at.desc')
    return result if result else []

def get_user_songs(client_id):
    """Get songs for specific user"""
    result = db_request('GET', f'conversions?client_id=eq.{client_id}&status=eq.completed&order=created_at.desc')
    return result if result else []

# --- Storage Upload ---
def upload_with_retry(file_path, storage_path, max_retries=3):
    """Upload with retry logic"""
    for attempt in range(max_retries):
        try:
            logger.info(f"📤 Upload attempt {attempt + 1}/{max_retries}")
            
            upload_url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET_NAME}/{storage_path}"
            
            headers = {
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Content-Type': 'audio/mpeg'
            }
            
            file_size = file_path.stat().st_size
            logger.info(f"File size: {file_size/(1024*1024):.2f} MB")
            
            with open(file_path, 'rb') as f:
                file_content = f.read()
            
            timeout = max(60, (file_size / (1024 * 1024)) * 10)
            timeout = min(timeout, 300)
            
            response = requests.post(
                upload_url,
                headers=headers,
                data=file_content,
                timeout=timeout
            )
            
            if response.status_code in [200, 201]:
                public_url = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET_NAME}/{storage_path}"
                logger.info(f"✅ Upload successful!")
                return public_url
            else:
                logger.warning(f"⚠️ Upload failed: {response.status_code} - {response.text}")
                
        except requests.exceptions.Timeout:
            logger.warning(f"⚠️ Upload timed out (attempt {attempt + 1})")
            if attempt < max_retries - 1:
                time.sleep(5)
        except Exception as e:
            logger.warning(f"⚠️ Upload error: {e}")
            if attempt < max_retries - 1:
                time.sleep(5)
    
    logger.error("❌ All upload attempts failed")
    return None

# --- Storage Delete ---
def delete_from_storage(storage_path):
    """Delete file from Supabase storage"""
    try:
        if not SUPABASE_URL or not SUPABASE_KEY:
            logger.error("Supabase credentials missing")
            return False
        
        delete_url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET_NAME}/{storage_path}"
        
        headers = {
            'Authorization': f'Bearer {SUPABASE_KEY}'
        }
        
        response = requests.delete(delete_url, headers=headers, timeout=10)
        
        if response.status_code in [200, 204]:
            logger.info(f"✅ Deleted from storage: {storage_path}")
            return True
        elif response.status_code == 404:
            logger.warning(f"⚠️ File not found in storage: {storage_path}")
            return True  # Already deleted
        else:
            logger.error(f"❌ Storage delete failed: {response.status_code} - {response.text}")
            return False
            
    except Exception as e:
        logger.error(f"❌ Storage delete error: {e}")
        return False

# ==========================================
# FIXED: Conversion Function with Folder Support
# ==========================================

def process_conversion(url, file_id, client_id, folder_name=None, bitrate='64'):
    """Process YouTube conversion with folder support"""
    try:
        if not is_owner(client_id):
            logger.error(f"❌ User {client_id} is not owner, cannot convert")
            update_in_db(file_id, {
                'status': 'error',
                'message': 'Only owner can add songs',
                'error_time': datetime.utcnow().isoformat()
            })
            return False
        
        logger.info(f"🎵 Owner processing: {file_id}, Folder: {folder_name}")
        
        update_in_db(file_id, {'status': 'downloading', 'progress': 10})
        
        # Create downloads directory
        base_download_dir = DOWNLOADS_DIR / client_id
        base_download_dir.mkdir(exist_ok=True)
        
        # Create folder directory if folder specified
        if folder_name and folder_name.strip():
            folder_dir = base_download_dir / folder_name.strip()
            folder_dir.mkdir(exist_ok=True)
            logger.info(f"📁 Created folder: {folder_dir}")
            download_dir = folder_dir
        else:
            download_dir = base_download_dir
        
        ffmpeg_path = find_ffmpeg_path()
        
        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': bitrate,
            }],
            'outtmpl': str(download_dir / f'{file_id}.%(ext)s'),  # Save to correct folder
            'quiet': True,
            'no_warnings': True,
            'extract_flat': False,
            'noplaylist': True,
        }
        
        if ffmpeg_path:
            ydl_opts['ffmpeg_location'] = ffmpeg_path
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get('title', 'audio')
            thumbnail = info.get('thumbnail')
            duration = info.get('duration', 0)
            
            logger.info(f"Downloaded: {title} to {download_dir}")
            update_in_db(file_id, {
                'status': 'converting', 
                'progress': 50,
                'title': title,
                'thumbnail': thumbnail,
                'duration': duration
            })
            
            mp3_path = download_dir / f'{file_id}.mp3'
            
            if mp3_path.exists():
                file_size = mp3_path.stat().st_size
                logger.info(f"MP3 created: {file_size/(1024*1024):.2f} MB")
                
                update_in_db(file_id, {
                    'status': 'uploading',
                    'progress': 70,
                    'file_size': file_size
                })
                
                # Use folder name in storage path
                if folder_name and folder_name.strip():
                    # Keep original folder name
                    storage_path = f"owner/{folder_name.strip()}/{file_id}.mp3"
                    logger.info(f"📁 Uploading to folder: {folder_name.strip()}, Path: {storage_path}")
                else:
                    storage_path = f"owner/{file_id}.mp3"
                    logger.info(f"📁 Uploading to root, Path: {storage_path}")
                    
                storage_url = upload_with_retry(mp3_path, storage_path)
                
                if storage_url:
                    update_in_db(file_id, {
                        'status': 'completed',
                        'progress': 100,
                        'folder': folder_name.strip() if folder_name else None,
                        'storage_url': storage_url,
                        'file_path': storage_path,
                        'completed_at': datetime.utcnow().isoformat()
                    })
                    
                    try:
                        mp3_path.unlink()
                    except:
                        pass
                    
                    logger.info(f"✅ Owner successfully added: {file_id} to folder: {folder_name}")
                    return True
                else:
                    update_in_db(file_id, {
                        'status': 'error',
                        'message': 'Storage upload failed',
                        'error_time': datetime.utcnow().isoformat()
                    })
                    return False
            else:
                update_in_db(file_id, {
                    'status': 'error',
                    'message': 'MP3 file not found',
                    'error_time': datetime.utcnow().isoformat()
                })
                return False
                
    except Exception as e:
        logger.error(f"❌ Processing error: {e}")
        update_in_db(file_id, {
            'status': 'error',
            'message': str(e)[:200],
            'error_time': datetime.utcnow().isoformat()
        })
        return False

# ==========================================
# API ENDPOINTS
# ==========================================

# --- API Routes ---
@app.route('/')
def index():
    """Serve admin UI when accessed via localhost/127.0.0.1, otherwise serve public user UI.

    This allows:
      - http://127.0.0.1:5000  -> admin panel
      - http://<LAN_IP>:5000   -> user view
    """
    try:
        host = request.host.split(':')[0]
    except Exception:
        host = ''

    # Treat localhost and 127.0.0.1 as admin access
    if host in ('127.0.0.1', 'localhost', '0.0.0.0'):
        return send_file('admin.html')

    # For any other host (LAN IPs), serve the public user view (library-only)
    # This ensures users on the network do not see the admin converter UI.
    return send_file('user.html')

@app.route('/style.css')
def css():
    return send_file('style.css', mimetype='text/css')

@app.route('/script.js')
def js():
    return send_file('script.js', mimetype='application/javascript')

@app.route('/logo.svg')
def logo():
    return send_file('logo.svg', mimetype='image/svg+xml')

@app.route('/logo-styles.css')
def logo_styles():
    return send_file('logo-styles.css', mimetype='text/css')

# --- User/Admin Detection ---
@app.route('/api/is-owner')
def check_owner():
    """Check if current user is owner/admin"""
    client_id = get_client_id()
    owner_status = is_owner(client_id)
    
    # If no owner set yet, first user becomes owner
    if not get_owner_id():
        set_owner_id(client_id)
        owner_status = True
    
    return jsonify({
        'is_owner': owner_status,
        'client_id': client_id,
        'owner_id': get_owner_id()
    })

@app.route('/api/set-owner', methods=['POST'])
def set_owner():
    """Set owner (admin only)"""
    data = request.json
    password = data.get('password', '')
    
    # Simple password check (you should use proper auth)
    if password == 'admin123':
        client_id = get_client_id()
        set_owner_id(client_id)
        return jsonify({'success': True, 'message': 'You are now the owner'})
    
    return jsonify({'error': 'Invalid password'}), 403

# ==========================================
# FIXED: Convert Endpoint with Folder Support
# ==========================================

@app.route('/api/convert', methods=['POST'])
def convert():
    """Convert YouTube URL - Owner only"""
    client_id = get_client_id()
    
    # Check if user is owner
    if not is_owner(client_id):
        return jsonify({'error': 'Only the owner can add new songs'}), 403
    
    data = request.json
    url = data.get('url', '').strip()
    
    if not url or ('youtube.com' not in url and 'youtu.be' not in url):
        return jsonify({'error': 'Invalid YouTube URL'}), 400
    
    folder = data.get('folder', '').strip()
    bitrate = str(data.get('bitrate', '64')).strip()
    if bitrate not in ['64', '128']:
        bitrate = '64'
    
    # Handle folder properly
    folder_name = None
    if folder and folder.strip():
        folder_name = folder.strip()
        logger.info(f"📁 User selected folder: '{folder_name}'")
    else:
        logger.info("📁 No folder selected, saving to root")

    # Check for duplicate URL (prevent duplicate conversions)
    try:
        encoded_url = urllib.parse.quote_plus(url)
        dup = db_request('GET', f'conversions?url=eq.{encoded_url}')
        if dup and len(dup) > 0:
            # Return conflict with existing file info
            existing = dup[0]
            logger.info(f"⚠️ Duplicate conversion attempt for URL: {url} (existing: {existing.get('file_id')})")
            return jsonify({
                'error': 'This URL has already been converted',
                'message': 'This link already exists in the library.',
                'existing_file_id': existing.get('file_id'),
                'existing_status': existing.get('status')
            }), 409
    except Exception as e:
        logger.warning(f"Error checking duplicate URL: {e}")

    file_id = str(uuid.uuid4())
    
    # Save initial data
    initial_data = {
        'file_id': file_id,
        'client_id': client_id,
        'status': 'queued',
        'folder': folder_name,  # This can be None or folder name
        'url': url,
        'bitrate': bitrate,
        'progress': 0,
        'created_at': datetime.utcnow().isoformat(),
        'started_at': datetime.utcnow().isoformat()
    }
    
    if not save_to_db(initial_data):
        return jsonify({'error': 'Failed to save to database'}), 500
    
    # Start processing
    thread = threading.Thread(
        target=process_conversion,
        args=(url, file_id, client_id, folder_name, bitrate)
    )
    thread.daemon = True
    thread.start()
    
    return jsonify({
        'file_id': file_id,
        'status': 'queued',
        'message': f"Conversion started. Saving to folder: {folder_name if folder_name else 'root'}",
        'folder': folder_name
    })

@app.route('/api/status/<file_id>')
def status(file_id):
    """Check conversion status - Anyone can check"""
    song = get_from_db(file_id)
    if not song:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(song)

@app.route('/api/status')
def all_status():
    """Get all statuses - Owner sees all, users see only completed"""
    client_id = get_client_id()
    
    if is_owner(client_id):
        # Owner sees all
        result = db_request('GET', f'conversions?order=created_at.desc')
    else:
        # Users see only completed songs
        result = db_request('GET', f'conversions?status=eq.completed&order=created_at.desc')
    
    return jsonify({'statuses': result if result else []})

@app.route('/api/download/<file_id>')
def download(file_id):
    """Download file - Anyone can download"""
    song = get_from_db(file_id)
    if not song or song.get('status') != 'completed':
        return jsonify({'error': 'File not ready'}), 400
    
    storage_url = song.get('storage_url')
    if storage_url:
        return redirect(storage_url)
    
    return jsonify({'error': 'Download URL not available'}), 404

# ==========================================
# FIXED: Play Endpoint - Now returns direct audio URL
# ==========================================

@app.route('/api/play/<file_id>')
def play(file_id):
    """Play audio file - Returns direct audio URL"""
    try:
        song = get_from_db(file_id)
        if not song:
            logger.error(f"❌ Song not found: {file_id}")
            return jsonify({'error': 'Not found'}), 404
        
        if song.get('status') != 'completed':
            logger.error(f"❌ Song not completed: {file_id}")
            return jsonify({'error': 'File not ready'}), 400
        
        storage_url = song.get('storage_url')
        if not storage_url:
            logger.error(f"❌ No storage URL for: {file_id}")
            return jsonify({'error': 'Audio URL not available'}), 404
        
        logger.info(f"🎵 Playing {file_id}: {storage_url}")
        
        # Return the direct audio URL for HTML5 audio player
        return jsonify({
            'url': storage_url,
            'title': song.get('title', 'Audio'),
            'success': True
        })
    
    except Exception as e:
        logger.error(f"❌ Error in play endpoint: {e}")
        return jsonify({'error': str(e)}), 500

# ==========================================
# FIXED: Folder Management Endpoints - SIMPLE AND WORKING
# ==========================================

@app.route('/api/folders', methods=['GET', 'POST', 'DELETE', 'OPTIONS'])
def handle_folders():
    """Handle folder operations - Create, List, and Delete"""
    if request.method == 'OPTIONS':
        return '', 200
    
    client_id = get_client_id()
    
    if request.method == 'POST':
        # Create a new folder (manually created by user)
        if not is_owner(client_id):
            return jsonify({'error': 'Only owner can create folders'}), 403
        
        data = request.json
        folder_name = data.get('name', '').strip()
        
        if not folder_name:
            return jsonify({'error': 'Folder name is required'}), 400
        
        # Create the folder in downloads directory
        folder_path = DOWNLOADS_DIR / client_id / folder_name
        folder_path.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"📁 Owner {client_id} created folder: {folder_path}")
        
        return jsonify({
            'success': True,
            'message': f'Folder "{folder_name}" created successfully',
            'folder': folder_name,
            'path': str(folder_path)
        })
    
    elif request.method == 'DELETE':
        # Delete a folder
        if not is_owner(client_id):
            return jsonify({'error': 'Only owner can delete folders'}), 403
        
        folder_name = request.args.get('name', '').strip()
        
        if not folder_name:
            return jsonify({'error': 'Folder name is required'}), 400
        
        # Normalize folder name
        folder_name = folder_name.strip()
        
        # Check if folder exists
        folder_path = DOWNLOADS_DIR / client_id / folder_name
        
        if not folder_path.exists() or not folder_path.is_dir():
            logger.error(f"❌ Folder does not exist: {folder_path}")
            return jsonify({'error': f'Folder "{folder_name}" does not exist'}), 404
        
        logger.info(f"🗑️ Starting folder deletion: {folder_name} at path: {folder_path}")
        
        # FIXED: Get ALL songs from the folder regardless of status
        all_songs_result = db_request('GET', f'conversions?folder=eq.{folder_name}')
        songs_in_folder = all_songs_result if all_songs_result else []
        
        logger.info(f"📊 Found {len(songs_in_folder)} total songs in folder '{folder_name}' (all statuses)")
        
        deleted_count = 0
        error_count = 0
        
        # Delete all songs from the folder (all statuses)
        for song in songs_in_folder:
            file_id = song.get('file_id')
            storage_path = song.get('file_path')
            
            # Log song details for debugging
            logger.info(f"🗑️ Processing song: {file_id}, status: {song.get('status')}, storage: {storage_path}")
            
            # Delete from storage if path exists
            if storage_path:
                logger.info(f"🗑️ Deleting from storage: {storage_path}")
                if not delete_from_storage(storage_path):
                    error_count += 1
                    logger.error(f"❌ Failed to delete from storage: {storage_path}")
            
            # Delete from database
            logger.info(f"🗑️ Deleting from database: {file_id}")
            result = db_request('DELETE', f'conversions?file_id=eq.{file_id}')
            if result:
                deleted_count += 1
                logger.info(f"✅ Deleted from database: {file_id}")
            else:
                error_count += 1
                logger.error(f"❌ Failed to delete from database: {file_id}")
        
        # FIXED: Windows-compatible folder deletion with proper error handling
        logger.info(f"🗑️ Attempting to delete folder from filesystem: {folder_path}")
        try:
            # First, change file permissions to ensure we can delete
            for root, dirs, files in os.walk(folder_path):
                for file in files:
                    file_path = Path(root) / file
                    try:
                        # On Windows, we need to ensure the file is not read-only
                        os.chmod(file_path, 0o777)
                    except:
                        pass  # Ignore permission errors on some files
            
            # Now try to delete the folder
            try:
                shutil.rmtree(folder_path)
                logger.info(f"✅ Successfully deleted folder from filesystem: {folder_path}")
            except PermissionError as pe:
                logger.warning(f"⚠️ Permission error, trying alternative method: {pe}")
                # Try alternative method for Windows
                import stat
                import errno
                
                def handle_remove_readonly(func, path, exc):
                    excvalue = exc[1]
                    if func in (os.rmdir, os.remove, os.unlink) and excvalue.errno == errno.EACCES:
                        os.chmod(path, stat.S_IRWXU | stat.S_IRWXG | stat.S_IRWXO)  # 0777
                        func(path)
                    else:
                        raise
                
                shutil.rmtree(folder_path, onerror=handle_remove_readonly)
                logger.info(f"✅ Successfully deleted folder using alternative method: {folder_path}")
                
        except Exception as e:
            logger.error(f"❌ Error deleting folder {folder_path}: {e}")
            error_count += 1
            return jsonify({
                'success': False,
                'error': f'Failed to delete folder from filesystem: {str(e)}',
                'deleted_count': deleted_count,
                'error_count': error_count
            }), 500
        
        logger.info(f"✅ Folder deletion completed: '{folder_name}'. {deleted_count} songs removed, {error_count} errors.")
        
        return jsonify({
            'success': True,
            'message': f'Folder "{folder_name}" deleted. {deleted_count} songs removed.',
            'deleted_count': deleted_count,
            'error_count': error_count
        })
    
    elif request.method == 'GET':
        # Get list of existing folders - ALL USERS CAN SEE FOLDERS
        folders = get_existing_folders(client_id)
        return jsonify({'folders': folders})

# ==========================================
# FIXED: get_existing_folders() function for BOTH owner and users
# ==========================================

def get_existing_folders(client_id):
    """Get list of existing folders - SHOWS FOLDERS FOR ALL USERS"""
    if not client_id:
        return []
    
    folders = []
    
    # Get owner ID to check if current user is owner
    owner_id = get_owner_id()
    is_current_user_owner = (client_id == owner_id)
    
    # Try to get folders from database first
    db_folders = []
    try:
        if SUPABASE_URL and SUPABASE_KEY:
            # Query database for all unique folder names (from completed songs)
            result = db_request('GET', 'conversions?status=eq.completed&select=folder')
            
            if result:
                # Extract unique folder names
                unique_folders = set()
                for song in result:
                    folder = song.get('folder')
                    if folder and folder.strip():
                        unique_folders.add(folder.strip())
                
                # For each unique folder, count songs and add to list
                for folder_name in unique_folders:
                    # Count songs in this folder
                    songs_in_folder = get_songs_by_folder(folder_name)
                    file_count = len(songs_in_folder) if songs_in_folder else 0
                    
                    # Only add folders that have songs
                    if file_count > 0:
                        db_folders.append({
                            'name': folder_name,
                            'file_count': file_count,
                            'path': f"owner/{folder_name}"
                        })
    except Exception as e:
        logger.error(f"Error getting folders from database: {e}")
    
    # Check owner's directory (filesystem) - ALWAYS do this as fallback/supplement
    try:
        if is_current_user_owner:
            base_dir = DOWNLOADS_DIR / client_id
            
            # Create base directory if it doesn't exist
            base_dir.mkdir(parents=True, exist_ok=True)
            
            # List all directories in the owner's downloads folder
            if base_dir.exists():
                for item in base_dir.iterdir():
                    if item.is_dir() and item.name != '.git' and item.name != '__pycache__':  # Skip hidden dirs
                        # Check if folder already in list (from database)
                        existing = next((f for f in db_folders if f['name'] == item.name), None)
                        
                        # Check filesystem for MP3 files
                        mp3_files = list(item.glob('*.mp3'))
                        file_count_from_fs = len(mp3_files)
                        
                        if existing:
                            # Update with filesystem count if higher
                            if file_count_from_fs > existing['file_count']:
                                existing['file_count'] = file_count_from_fs
                        else:
                            # Add new folder from filesystem
                            # Include folders even if they are empty so newly-created admin
                            # folders show up immediately in the UI (file_count may be 0).
                            db_folders.append({
                                'name': item.name,
                                'file_count': file_count_from_fs,
                                'path': str(item)
                            })
    except Exception as e:
        logger.error(f"Error scanning filesystem folders: {e}")
    
    # If still no folders and database is unavailable, scan the downloads directory more broadly
    if not db_folders:
        try:
            logger.info("📂 Database unavailable or empty, scanning filesystem...")
            # Scan the downloads directory for any subdirectories with MP3 files
            downloads_root = DOWNLOADS_DIR
            if downloads_root.exists():
                for user_dir in downloads_root.iterdir():
                    if user_dir.is_dir():
                        for folder_dir in user_dir.iterdir():
                            if folder_dir.is_dir() and folder_dir.name != '__pycache__':
                                mp3_files = list(folder_dir.glob('**/*.mp3'))
                                if mp3_files:
                                    # Check if not already in list
                                    if not any(f['name'] == folder_dir.name for f in db_folders):
                                        db_folders.append({
                                            'name': folder_dir.name,
                                            'file_count': len(mp3_files),
                                            'path': str(folder_dir)
                                        })
        except Exception as e:
            logger.error(f"Error in fallback filesystem scan: {e}")
    
    folders = db_folders
    
    # Sort by name
    folders.sort(key=lambda x: x['name'].lower())
    
    logger.info(f"📁 Found {len(folders)} folders (all users)")
    return folders

# ==========================================
# FIXED: File Delete Endpoint
# ==========================================

@app.route('/api/delete-file/<path:filename>', methods=['DELETE', 'OPTIONS'])
def delete_file(filename):
    """Delete a file from storage and database"""
    if request.method == 'OPTIONS':
        return '', 200
    
    client_id = get_client_id()
    
    # Decode URL-encoded filename
    try:
        decoded_filename = urllib.parse.unquote(filename)
    except:
        decoded_filename = filename
    
    logger.info(f"🗑️ Delete request for: {decoded_filename} by {client_id}")
    
    # Only owner can delete files
    if not is_owner(client_id):
        logger.error(f"❌ User {client_id} is not owner, cannot delete")
        return jsonify({'error': 'Only owner can delete files'}), 403
    
    # Parse filename to get file_id
    if decoded_filename.endswith('.mp3'):
        file_id = decoded_filename.replace('.mp3', '')
        
        # If there's a folder path, extract just the file_id
        if '/' in file_id:
            parts = file_id.split('/')
            file_id = parts[-1]
    else:
        file_id = decoded_filename
    
    # Get song from database
    song = get_from_db(file_id)
    if not song:
        logger.error(f"❌ File not found in database: {file_id}")
        return jsonify({'error': 'File not found in database'}), 404
    
    # Delete from storage
    storage_path = song.get('file_path')
    if storage_path:
        if not delete_from_storage(storage_path):
            logger.warning(f"⚠️ Could not delete from storage, but continuing with DB deletion")
    
    # Delete from database
    result = db_request('DELETE', f'conversions?file_id=eq.{file_id}')
    
    if result:
        logger.info(f"✅ Successfully deleted file: {decoded_filename}")
        return jsonify({
            'success': True,
            'message': 'File deleted successfully',
            'filename': decoded_filename,
            'file_id': file_id
        })
    else:
        logger.error(f"❌ Failed to delete from database: {file_id}")
        return jsonify({'error': 'Failed to delete from database'}), 500

# ==========================================
# FIXED: List Files Endpoint - SHOWS ALL SONGS FOR ALL USERS
# ==========================================

@app.route('/api/files')
def list_files():
    """List all songs - Everyone can see all completed songs"""
    client_id = get_client_id()
    folder_filter = request.args.get('folder')
    
    # Try to get songs from database first
    songs = []
    if SUPABASE_URL and SUPABASE_KEY:
        if folder_filter and folder_filter != 'root':
            songs = get_songs_by_folder(folder_filter)
        else:
            songs = get_all_songs()
    
    files = {'folders': {}, 'root': []}
    
    # Process database songs
    for song in songs:
        # Only show completed songs
        if song.get('status') != 'completed':
            continue
        
        # Get folder name (if any)
        folder = song.get('folder')
        
        # Get file_id
        file_id = song.get('file_id')
        
        # Create file object with correct play URL
        file_obj = {
            'filename': f"{file_id}.mp3",
            'display_name': song.get('title', 'Unknown'),
            'size': song.get('file_size', 0),
            'modified': int(datetime.fromisoformat(song.get('completed_at', datetime.utcnow().isoformat())).timestamp()),
            'url': f"/api/play/{file_id}",  # This is the correct play URL
            'source_url': song.get('url'),
            'folder': folder,
            'thumbnail': song.get('thumbnail'),
            'duration': song.get('duration', 0),
            'created_at': song.get('created_at'),
            'file_id': file_id,
            'download_url': f"/api/download/{file_id}"
        }
        
        # If folder filter is applied, just return files
        if folder_filter:
            files['files'] = files.get('files', [])
            files['files'].append(file_obj)
        else:
            # Add to appropriate location for all files view
            if folder:
                if folder not in files['folders']:
                    files['folders'][folder] = []
                files['folders'][folder].append(file_obj)
            else:
                files['root'].append(file_obj)
    
    # FALLBACK: If database is empty/unavailable, scan filesystem
    if not songs and not folder_filter:
        try:
            logger.info("📂 Database unavailable or empty, scanning filesystem for MP3 files...")
            downloads_root = DOWNLOADS_DIR
            if downloads_root.exists():
                for user_dir in downloads_root.iterdir():
                    if user_dir.is_dir():
                        for folder_dir in user_dir.iterdir():
                            if folder_dir.is_dir() and folder_dir.name != '__pycache__':
                                mp3_files = list(folder_dir.glob('*.mp3'))
                                for mp3_file in mp3_files:
                                    try:
                                        file_id = mp3_file.stem
                                        folder_name = folder_dir.name
                                        
                                        file_obj = {
                                            'filename': mp3_file.name,
                                                'display_name': file_id,
                                            'size': mp3_file.stat().st_size,
                                            'modified': int(mp3_file.stat().st_mtime),
                                            'url': f"/api/play/{file_id}",
                                                'folder': folder_name,
                                                'source_url': None,
                                            'file_id': file_id,
                                            'download_url': f"/api/download/{file_id}"
                                        }
                                        
                                        if folder_name not in files['folders']:
                                            files['folders'][folder_name] = []
                                        files['folders'][folder_name].append(file_obj)
                                    except Exception as e:
                                        logger.error(f"Error processing file {mp3_file}: {e}")
        except Exception as e:
            logger.error(f"Error scanning filesystem: {e}")
    elif folder_filter and not (files.get('files') or songs):
        # Fallback for specific folder
        try:
            logger.info(f"📂 Database unavailable for folder '{folder_filter}', scanning filesystem...")
            downloads_root = DOWNLOADS_DIR
            if downloads_root.exists():
                for user_dir in downloads_root.iterdir():
                    if user_dir.is_dir():
                        folder_dir = user_dir / folder_filter
                        if folder_dir.exists() and folder_dir.is_dir():
                            mp3_files = list(folder_dir.glob('*.mp3'))
                            files['files'] = []
                            for mp3_file in mp3_files:
                                try:
                                    file_id = mp3_file.stem
                                    file_obj = {
                                        'filename': mp3_file.name,
                                        'display_name': file_id,
                                        'size': mp3_file.stat().st_size,
                                        'modified': int(mp3_file.stat().st_mtime),
                                        'url': f"/api/play/{file_id}",
                                        'folder': folder_filter,
                                        'file_id': file_id,
                                        'download_url': f"/api/download/{file_id}"
                                    }
                                    files['files'].append(file_obj)
                                except Exception as e:
                                    logger.error(f"Error processing file {mp3_file}: {e}")
        except Exception as e:
            logger.error(f"Error in fallback folder scan: {e}")
    
    return jsonify(files)

# ==========================================
# Download File by Filename
# ==========================================

@app.route('/api/download-file/<path:filename>')
def download_file(filename):
    """Download file by filename (for library download button)"""
    try:
        # Extract file_id from filename
        if filename.endswith('.mp3'):
            file_id = filename.replace('.mp3', '')
        else:
            file_id = filename
        
        # Get song from database
        song = get_from_db(file_id)
        if not song or song.get('status') != 'completed':
            return jsonify({'error': 'File not found or not ready'}), 404
        
        storage_url = song.get('storage_url')
        if storage_url:
            return redirect(storage_url)
        
        return jsonify({'error': 'Download URL not available'}), 404
        
    except Exception as e:
        logger.error(f"Download file error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/song-info', methods=['POST'])
def song_info():
    """Get song info without downloading - Anyone can use"""
    try:
        data = request.get_json()
        url = data.get('url')
        
        if not url:
            return jsonify({'error': 'URL is required'}), 400
        
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            return jsonify({
                'title': info.get('title', 'Unknown'),
                'duration': info.get('duration', 0),
                'thumbnail': info.get('thumbnail', ''),
                'uploader': info.get('uploader', ''),
                'view_count': info.get('view_count', 0)
            })
            
    except Exception as e:
        logger.error(f"Error in song-info endpoint: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/health')
def health():
    """Health check - Anyone can check"""
    try:
        test = db_request('GET', 'conversions?select=count&limit=1')
        
        owner_id = get_owner_id()
        
        return jsonify({
            'status': 'healthy' if test else 'degraded',
            'database': 'connected' if test else 'disconnected',
            'owner_set': bool(owner_id),
            'owner_id': owner_id,
            'timestamp': datetime.utcnow().isoformat()
        })
            
    except Exception as e:
        return jsonify({
            'status': 'unhealthy',
            'error': str(e)
        }), 500


# --- Thumbnail proxy to avoid CORS/hotlink issues ---
@app.route('/api/thumbnail')
def thumbnail_proxy():
    url = request.args.get('url')
    if not url or not (url.startswith('http://') or url.startswith('https://')):
        return jsonify({'error': 'Invalid URL'}), 400
    try:
        # Server-side caching to avoid repeated upstream hits and hotlink/CORS issues
        import hashlib
        cache_dir = DOWNLOADS_DIR / '.thumbcache'
        cache_dir.mkdir(parents=True, exist_ok=True)

        key = hashlib.sha256(url.encode('utf-8')).hexdigest()
        # Guess extension from url or default to .jpg
        ext = '.jpg'
        parsed = urllib.parse.urlparse(url)
        if parsed.path:
            pext = Path(parsed.path).suffix
            if pext and len(pext) <= 5:
                ext = pext

        cache_file = cache_dir / f"{key}{ext}"

        logger.info(f"Thumbnail proxy requested: {url} -> cache {cache_file}")

        # Helper to map file extension to mimetype
        def mimetype_for_path(p: Path):
            ext = p.suffix.lower()
            if ext in ('.jpg', '.jpeg'): return 'image/jpeg'
            if ext == '.png': return 'image/png'
            if ext == '.webp': return 'image/webp'
            if ext == '.gif': return 'image/gif'
            return 'application/octet-stream'

        # If cached and recent (5 minutes), serve directly
        if cache_file.exists() and (time.time() - cache_file.stat().st_mtime) < 300:
            logger.info(f"Serving cached thumbnail for {url}")
            return send_file(str(cache_file), mimetype=mimetype_for_path(cache_file), conditional=True)

        headers = {'User-Agent': 'TuneVerse/1.0 (+https://example.com)'}
        resp = requests.get(url, headers=headers, stream=True, timeout=10)
        logger.info(f"Thumbnail upstream status {resp.status_code} for {url}")
        if resp.status_code != 200:
            logger.warning(f"Thumbnail proxy upstream returned {resp.status_code} for {url}")
            return ('', resp.status_code)

        # Write to temporary file then move
        try:
            tmp_path = cache_dir / f"{key}.tmp"
            with open(tmp_path, 'wb') as w:
                for chunk in resp.iter_content(8192):
                    if chunk:
                        w.write(chunk)
            # Ensure we actually wrote data
            if tmp_path.exists() and tmp_path.stat().st_size > 0:
                tmp_path.replace(cache_file)
            else:
                if tmp_path.exists():
                    tmp_path.unlink()
                raise Exception('Empty thumbnail downloaded')
        except Exception as e:
            logger.error(f"Error caching thumbnail {url}: {e}")
            # Fall back to streaming response
            def generate():
                try:
                    for chunk in resp.iter_content(8192):
                        if chunk:
                            yield chunk
                except Exception:
                    return
            proxy_resp = Response(generate(), content_type=resp.headers.get('Content-Type', 'image/jpeg'))
            proxy_resp.headers['Cache-Control'] = 'public, max-age=300'
            proxy_resp.headers['Access-Control-Allow-Origin'] = '*'
            return proxy_resp

        # Serve cached file
        logger.info(f"Cached thumbnail saved: {cache_file}")
        return send_file(str(cache_file), mimetype=resp.headers.get('Content-Type', mimetype_for_path(cache_file)), conditional=True)
    except Exception as e:
        logger.error(f"Thumbnail proxy error for {url}: {e}")
        return ('', 500)

# --- Frontend Routes for different views ---
@app.route('/admin')
def admin_panel():
    """Admin panel page - Only owner should access"""
    return send_file('admin.html')

@app.route('/user')
def user_view():
    """User view page - Everyone can access"""
    return send_file('user.html')

# ==========================================
# Direct Audio Stream Endpoint (for HTML5 audio player)
# ==========================================

@app.route('/api/stream/<file_id>')
def stream_audio(file_id):
    """Direct audio streaming endpoint for HTML5 audio player"""
    try:
        song = get_from_db(file_id)
        if not song or song.get('status') != 'completed':
            return jsonify({'error': 'File not ready'}), 400
        
        storage_url = song.get('storage_url')
        if storage_url:
            # Redirect to the Supabase storage URL directly
            return redirect(storage_url)
        
        return jsonify({'error': 'Audio URL not available'}), 404
        
    except Exception as e:
        logger.error(f"Stream audio error: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    logger.info("🚀 TuneVerse Server Starting...")
    logger.info(f"Supabase: {SUPABASE_URL}")
    
    # Check owner
    owner_id = get_owner_id()
    if owner_id:
        logger.info(f"📱 Owner ID: {owner_id}")
    else:
        logger.info("📱 No owner set yet - first user will become owner")
    
    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.error("❌ Missing Supabase credentials in .env file!")
    
    port = int(os.environ.get('PORT', 5000))
    logger.info(f"🌐 Server running on http://0.0.0.0:{port}")
    logger.info(f"🌐 Admin panel: http://0.0.0.0:{port}/admin")
    logger.info(f"🌐 User view: http://0.0.0.0:{port}/user")
    app.run(host='0.0.0.0', port=port, debug=True)
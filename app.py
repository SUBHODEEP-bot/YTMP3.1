from flask import Flask, request, jsonify, send_file, redirect
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

# Debug
logger.info(f"Supabase URL: {SUPABASE_URL}")

# Create directories
DOWNLOADS_DIR = Path('downloads')
DOWNLOADS_DIR.mkdir(exist_ok=True)

CLIENT_ID_HEADER = 'X-Client-Id'

def get_client_id():
    cid = request.headers.get(CLIENT_ID_HEADER) or request.args.get('client_id')
    if not cid:
        return 'public'
    cid = ''.join(c for c in str(cid) if c.isalnum() or c in ('-', '_'))
    return cid or 'public'

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
        else:
            return None
        
        if response.status_code in [200, 201]:
            return response.json()
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

# --- Storage Upload (Optimized) ---
def upload_with_retry(file_path, storage_path, max_retries=3):
    """Upload with retry logic and progress tracking"""
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
            
            # Read file in chunks for progress
            with open(file_path, 'rb') as f:
                # Upload in one go (simpler)
                file_content = f.read()
            
            # Calculate timeout based on file size (1 MB per 10 seconds)
            timeout = max(60, (file_size / (1024 * 1024)) * 10)
            timeout = min(timeout, 300)  # Max 5 minutes
            
            logger.info(f"Upload timeout: {timeout} seconds")
            
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
                logger.info("Waiting 5 seconds before retry...")
                time.sleep(5)
        except Exception as e:
            logger.warning(f"⚠️ Upload error: {e}")
            if attempt < max_retries - 1:
                logger.info("Waiting 5 seconds before retry...")
                time.sleep(5)
    
    logger.error("❌ All upload attempts failed")
    return None

# --- Conversion Function ---
def process_conversion(url, file_id, client_id, folder_name=None, bitrate='64'):
    """Process YouTube conversion"""
    try:
        logger.info(f"🎵 Processing: {file_id}")
        
        # Update status
        update_in_db(file_id, {'status': 'downloading', 'progress': 10})
        
        # Create user directory
        user_dir = DOWNLOADS_DIR / client_id
        user_dir.mkdir(exist_ok=True)
        
        # Download and convert
        ffmpeg_path = find_ffmpeg_path()
        
        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': bitrate,
            }],
            'outtmpl': str(user_dir / f'{file_id}.%(ext)s'),
            'quiet': True,  # Less verbose
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
            
            logger.info(f"Downloaded: {title}")
            update_in_db(file_id, {
                'status': 'converting', 
                'progress': 50,
                'title': title,
                'thumbnail': thumbnail,
                'duration': duration
            })
            
            # Find MP3 file
            mp3_path = user_dir / f'{file_id}.mp3'
            
            if mp3_path.exists():
                file_size = mp3_path.stat().st_size
                logger.info(f"MP3 created: {file_size/(1024*1024):.2f} MB")
                
                update_in_db(file_id, {
                    'status': 'uploading',
                    'progress': 70,
                    'file_size': file_size
                })
                
                # Upload to storage
                storage_path = f"{client_id}/{file_id}.mp3"
                storage_url = upload_with_retry(mp3_path, storage_path)
                
                if storage_url:
                    # Update final status
                    update_in_db(file_id, {
                        'status': 'completed',
                        'progress': 100,
                        'folder': folder_name,
                        'storage_url': storage_url,
                        'file_path': storage_path,
                        'completed_at': datetime.utcnow().isoformat()
                    })
                    
                    # Clean up
                    try:
                        mp3_path.unlink()
                    except:
                        pass
                    
                    logger.info(f"✅ Successfully processed {file_id}")
                    return True
                else:
                    update_in_db(file_id, {
                        'status': 'error',
                        'message': 'Storage upload failed after retries',
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

# --- API Routes ---
@app.route('/')
def index():
    return send_file('index.html')

@app.route('/api/convert', methods=['POST'])
def convert():
    data = request.json
    url = data.get('url', '').strip()
    
    if not url or ('youtube.com' not in url and 'youtu.be' not in url):
        return jsonify({'error': 'Invalid YouTube URL'}), 400
    
    folder = data.get('folder')
    bitrate = str(data.get('bitrate', '64')).strip()
    if bitrate not in ['64', '128']:
        bitrate = '64'
    
    folder_name = None
    if folder:
        sanitized = "".join(c for c in folder if c.isalnum() or c in (' ', '-', '_')).strip()
        folder_name = sanitized if sanitized else None
    
    client_id = get_client_id()
    file_id = str(uuid.uuid4())
    
    # Save initial data
    initial_data = {
        'file_id': file_id,
        'client_id': client_id,
        'status': 'queued',
        'folder': folder_name,
        'url': url,
        'bitrate': bitrate,
        'progress': 0,
        'created_at': datetime.utcnow().isoformat(),
        'started_at': datetime.utcnow().isoformat()
    }
    
    if not save_to_db(initial_data):
        return jsonify({'error': 'Failed to save to database'}), 500
    
    # Start processing in background
    thread = threading.Thread(
        target=process_conversion,
        args=(url, file_id, client_id, folder_name, bitrate)
    )
    thread.daemon = True
    thread.start()
    
    return jsonify({
        'file_id': file_id,
        'status': 'queued',
        'message': 'Conversion started. This may take a few minutes.'
    })

@app.route('/api/status/<file_id>')
def status(file_id):
    song = get_from_db(file_id)
    if not song:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(song)

@app.route('/api/status')
def all_status():
    client_id = get_client_id()
    result = db_request('GET', f'conversions?client_id=eq.{client_id}&order=created_at.desc')
    return jsonify({'statuses': result if result else []})

@app.route('/api/download/<file_id>')
def download(file_id):
    song = get_from_db(file_id)
    if not song or song.get('status') != 'completed':
        return jsonify({'error': 'File not ready'}), 400
    
    storage_url = song.get('storage_url')
    if storage_url:
        return redirect(storage_url)
    
    return jsonify({'error': 'Download URL not available'}), 404

@app.route('/api/files')
def list_files():
    client_id = get_client_id()
    result = db_request('GET', f'conversions?client_id=eq.{client_id}&status=eq.completed&order=created_at.desc')
    
    if not result:
        return jsonify({'folders': {}, 'root': []})
    
    files = {'folders': {}, 'root': []}
    for song in result:
        song_info = {
            'file_id': song['file_id'],
            'display_name': song.get('title', 'Unknown'),
            'size': song.get('file_size', 0),
            'duration': song.get('duration', 0),
            'url': song.get('storage_url', ''),
            'download_url': f"/api/download/{song['file_id']}",
            'folder': song.get('folder'),
            'thumbnail': song.get('thumbnail'),
            'created_at': song.get('created_at')
        }
        
        folder = song.get('folder')
        if folder:
            if folder not in files['folders']:
                files['folders'][folder] = []
            files['folders'][folder].append(song_info)
        else:
            files['root'].append(song_info)
    
    return jsonify(files)

@app.route('/api/folders')
def list_folders():
    client_id = get_client_id()
    result = db_request('GET', f'conversions?client_id=eq.{client_id}&status=eq.completed&select=folder')
    
    if not result:
        return jsonify({'folders': []})
    
    folders = {}
    for song in result:
        folder = song.get('folder')
        if folder:
            folders[folder] = folders.get(folder, 0) + 1
    
    folder_list = [{'name': name, 'file_count': count} for name, count in folders.items()]
    folder_list.sort(key=lambda x: x['name'].lower())
    
    return jsonify({'folders': folder_list})

@app.route('/api/health')
def health():
    try:
        # Quick test
        test = db_request('GET', 'conversions?select=count&limit=1')
        
        if test:
            return jsonify({
                'status': 'healthy',
                'database': 'connected',
                'storage': 'ready',
                'timestamp': datetime.utcnow().isoformat()
            })
        else:
            return jsonify({
                'status': 'degraded',
                'database': 'disconnected',
                'message': 'Check Supabase connection'
            }), 500
            
    except Exception as e:
        return jsonify({
            'status': 'unhealthy',
            'error': str(e)
        }), 500

if __name__ == '__main__':
    logger.info("🚀 TuneVerse Server Starting...")
    logger.info(f"Supabase: {SUPABASE_URL}")
    
    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.error("❌ Missing Supabase credentials in .env file!")
    
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
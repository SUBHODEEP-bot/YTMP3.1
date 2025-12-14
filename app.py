from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import yt_dlp
import os
import uuid
import threading
import shutil
import json
from pathlib import Path

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

# Create downloads directory if it doesn't exist
DOWNLOADS_DIR = Path('downloads')
DOWNLOADS_DIR.mkdir(exist_ok=True)

# Status file to persist across reloads
STATUS_FILE = Path('conversion_status.json')

def load_status():
    """Load conversion status from file"""
    if STATUS_FILE.exists():
        try:
            with open(STATUS_FILE, 'r') as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_status(status):
    """Save conversion status to file"""
    try:
        with open(STATUS_FILE, 'w') as f:
            json.dump(status, f)
    except Exception as e:
        print(f"Error saving status: {e}")

def get_status(file_id):
    """Get status for a file_id"""
    status = load_status()
    return status.get(file_id, None)

def set_status(file_id, status_info):
    """Set status for a file_id"""
    status = load_status()
    status[file_id] = status_info
    save_status(status)

def delete_status(file_id):
    """Delete status for a file_id"""
    status = load_status()
    if file_id in status:
        del status[file_id]
        save_status(status)

def get_thumbnail_for_file(filename):
    """Extract file_id from filename and get thumbnail from status"""
    try:
        # Extract file_id from filename (first 36 characters for UUID)
        if '_' in filename and len(filename) > 36:
            file_id = filename.split('_')[0]
            if len(file_id) == 36:  # UUID length
                status = get_status(file_id)
                if status and status.get('thumbnail'):
                    return status['thumbnail']
    except:
        pass
    return None

# Find and add FFmpeg to PATH at startup
ffmpeg_path = None

def find_ffmpeg_path():
    """Find FFmpeg executable path"""
    # First, try to find it in PATH
    ffmpeg_path = shutil.which('ffmpeg')
    if ffmpeg_path:
        # Get the directory containing ffmpeg
        ffmpeg_dir = str(Path(ffmpeg_path).parent)
        return ffmpeg_dir
    
    # Try to get from system PATH (refresh it)
    import subprocess
    try:
        # Refresh PATH from system
        result = subprocess.run(['where.exe', 'ffmpeg'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0 and result.stdout.strip():
            ffmpeg_exe = result.stdout.strip().split('\n')[0]
            return str(Path(ffmpeg_exe).parent)
    except:
        pass
    
    # If not in PATH, try common installation locations on Windows
    common_paths = [
        r'C:\ffmpeg\bin',
        r'C:\Program Files\ffmpeg\bin',
        r'C:\Program Files (x86)\ffmpeg\bin',
    ]
    
    # Check WinGet packages directory (but limit depth to avoid slow search)
    winget_base = os.path.expanduser(r'~\AppData\Local\Microsoft\WinGet\Packages')
    if os.path.exists(winget_base):
        try:
            # Look for Gyan.FFmpeg specifically
            for item in os.listdir(winget_base):
                if 'FFmpeg' in item or 'ffmpeg' in item:
                    item_path = os.path.join(winget_base, item)
                    if os.path.isdir(item_path):
                        try:
                            # Look for bin directory
                            for subitem in os.listdir(item_path):
                                subitem_path = os.path.join(item_path, subitem)
                                if os.path.isdir(subitem_path):
                                    bin_path = os.path.join(subitem_path, 'bin')
                                    if os.path.exists(bin_path):
                                        try:
                                            if 'ffmpeg.exe' in os.listdir(bin_path):
                                                return bin_path
                                        except (PermissionError, OSError):
                                            continue
                        except (PermissionError, OSError):
                            continue
        except (PermissionError, OSError):
            pass
    
    return None

def reencode_mp3_for_browser(input_path, output_path):
    """Re-encode MP3 file to ensure browser compatibility"""
    ffmpeg_path = find_ffmpeg_path()
    ffmpeg_exe = None
    
    if ffmpeg_path:
        ffmpeg_exe = Path(ffmpeg_path) / 'ffmpeg.exe'
        if not ffmpeg_exe.exists():
            ffmpeg_exe = shutil.which('ffmpeg')
    else:
        ffmpeg_exe = shutil.which('ffmpeg')
    
    if not ffmpeg_exe:
        print("FFmpeg not found for re-encoding")
        return False
    
    import subprocess
    try:
        # Re-encode with browser-compatible settings
        cmd = [
            str(ffmpeg_exe),
            '-i', str(input_path),
            '-acodec', 'libmp3lame',
            '-b:a', '192k',  # CBR for compatibility
            '-ar', '44100',
            '-ac', '2',
            '-f', 'mp3',
            '-y',  # Overwrite output file
            str(output_path)
        ]
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )
        
        if result.returncode == 0 and output_path.exists():
            return True
        else:
            print(f"FFmpeg re-encoding error: {result.stderr}")
            return False
    except Exception as e:
        print(f"Error re-encoding MP3: {e}")
        return False

def download_mp3(url, file_id, folder_name=None, bitrate='64'):
    """Download YouTube video and convert to MP3"""
    try:
        # Validate bitrate - ensure it's a string
        bitrate = str(bitrate).strip()
        if bitrate not in ['64', '128']:
            bitrate = '64'
        
        # Determine target directory
        if folder_name:
            target_dir = DOWNLOADS_DIR / folder_name
            target_dir.mkdir(exist_ok=True)
        else:
            target_dir = DOWNLOADS_DIR
        
        output_path = target_dir / f"{file_id}.%(ext)s"
        
        # Find FFmpeg path
        ffmpeg_path = find_ffmpeg_path()
        
        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': bitrate,
            }],
            'outtmpl': str(output_path),
            'quiet': False,  # Enable output to see errors
            'no_warnings': False,  # Show warnings
            'extract_flat': False,
            'noplaylist': True,
            # Ensure browser-compatible MP3 encoding with explicit parameters
            # Use CBR (Constant Bitrate) instead of VBR for better browser compatibility
            'postprocessor_args': {
                'ffmpeg': [
                    '-acodec', 'libmp3lame',
                    '-b:a', f'{bitrate}k',  # Constant bitrate (CBR) - dynamic based on user selection
                    '-ar', '44100',  # Sample rate
                    '-ac', '2',  # Stereo
                    '-f', 'mp3'  # Force MP3 format
                ]
            },
            # Force format to ensure conversion
            'keepvideo': False,
        }
        
        # Add FFmpeg location if found
        if ffmpeg_path:
            ydl_opts['ffmpeg_location'] = ffmpeg_path
        
        # Update PATH to include FFmpeg directory if found
        if ffmpeg_path and ffmpeg_path not in os.environ.get('PATH', ''):
            os.environ['PATH'] = ffmpeg_path + os.pathsep + os.environ.get('PATH', '')
        
        # Suppress any requests/urllib3 warnings
        import warnings
        warnings.filterwarnings('ignore')
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get('title', 'audio')
            thumbnail = info.get('thumbnail', None)  # Get thumbnail URL
            
            # Wait for conversion to complete - check multiple times
            import time
            mp3_file = None
            max_wait = 30  # Maximum wait time in seconds
            wait_interval = 0.5
            waited = 0
            
            while waited < max_wait:
                # First, try to find by file_id pattern in target directory
                for file in target_dir.glob(f"{file_id}.*"):
                    if file.suffix == '.mp3':
                        mp3_file = file
                        break
                
                if mp3_file and mp3_file.exists():
                    # Verify it's actually an MP3 by checking file header
                    try:
                        with open(mp3_file, 'rb') as f:
                            header = f.read(3)
                            if header.startswith(b'ID3') or header.startswith(b'\xff\xfb') or header.startswith(b'\xff\xf3'):
                                break  # Valid MP3 found
                    except:
                        pass
                
                time.sleep(wait_interval)
                waited += wait_interval
            
            # If still not found, look for the most recently created MP3 file in target directory
            if not mp3_file or not mp3_file.exists():
                mp3_files = list(target_dir.glob("*.mp3"))
                if mp3_files:
                    # Get the most recently modified file
                    mp3_file = max(mp3_files, key=lambda p: p.stat().st_mtime)
                    # Verify it's recent (within last 5 minutes)
                    file_age = time.time() - mp3_file.stat().st_mtime
                    if file_age > 300:  # Older than 5 minutes
                        mp3_file = None
            
            if mp3_file and mp3_file.exists():
                # Final verification - check file header
                is_valid_mp3 = False
                try:
                    with open(mp3_file, 'rb') as f:
                        header = f.read(10)
                        # Check for MP3 signatures: ID3, MPEG sync words
                        if (header.startswith(b'ID3') or 
                            header.startswith(b'\xff\xfb') or 
                            header.startswith(b'\xff\xf3') or
                            header.startswith(b'\xff\xfa') or
                            header.startswith(b'\xff\xf2')):
                            is_valid_mp3 = True
                        else:
                            print(f"Warning: File {mp3_file} may not be a valid MP3. Header: {header[:10]}")
                except Exception as e:
                    print(f"Error verifying MP3 file: {e}")
                
                if not is_valid_mp3:
                    set_status(file_id, {
                        'status': 'error',
                        'message': 'Converted file is not a valid MP3 format. FFmpeg conversion may have failed.'
                    })
                    return
                
                # Rename with title and file_id to avoid conflicts
                safe_title = "".join(c for c in title if c.isalnum() or c in (' ', '-', '_')).rstrip()
                # Limit title length to avoid filesystem issues
                safe_title = safe_title[:100] if len(safe_title) > 100 else safe_title
                final_filename = f"{file_id}_{safe_title}.mp3"
                final_path = DOWNLOADS_DIR / final_filename
                
                # Remove existing file if it exists
                if final_path.exists():
                    final_path.unlink()
                
                # Rename into the target directory (respect selected folder)
                final_path = target_dir / final_filename
                mp3_file.rename(final_path)
                
                # Verify the renamed file
                if not final_path.exists():
                    raise Exception("File rename failed")
                
                # Clean up any leftover webm/other format files with same file_id
                for leftover_file in target_dir.glob(f"{file_id}.*"):
                    if leftover_file.suffix != '.mp3' and leftover_file.exists():
                        try:
                            leftover_file.unlink()
                            print(f"Cleaned up leftover file: {leftover_file}")
                        except:
                            pass
                
                # Store filename as relative path including folder if used
                stored_filename = f"{folder_name}/{final_filename}" if folder_name else final_filename
                set_status(file_id, {
                    'status': 'completed',
                    'filename': stored_filename,
                    'title': title,
                    'folder': folder_name if folder_name else None,
                    'thumbnail': thumbnail  # Store thumbnail URL
                })
            else:
                # Clean up any partial downloads
                for partial_file in target_dir.glob(f"{file_id}.*"):
                    try:
                        partial_file.unlink()
                    except:
                        pass
                
                set_status(file_id, {
                    'status': 'error',
                    'message': 'MP3 file not found after conversion. FFmpeg may not be properly installed or the conversion failed.'
                })
    except Exception as e:
        error_msg = str(e)
        # Provide more user-friendly error messages
        if 'RequestsResponseAdapter' in error_msg or '_http_error' in error_msg:
            error_msg = 'Network error occurred. Please try again or check your internet connection.'
        elif 'ffprobe' in error_msg.lower() or 'ffmpeg' in error_msg.lower():
            error_msg = 'FFmpeg not found. Please ensure FFmpeg is installed and in your system PATH.'
        elif 'unavailable' in error_msg.lower() or 'private' in error_msg.lower():
            error_msg = 'Video is unavailable or private. Please check the URL.'
        elif 'sign in' in error_msg.lower() or 'age-restricted' in error_msg.lower():
            error_msg = 'This video requires sign-in or is age-restricted and cannot be downloaded.'
        
        # Log the full error for debugging
        print(f"Error converting {url}: {error_msg}")
        
        set_status(file_id, {
            'status': 'error',
            'message': error_msg
        })

@app.route('/')
def index():
    """Serve the main page"""
    return send_file('index.html')

@app.route('/style.css')
def css():
    """Serve CSS file"""
    return send_file('style.css', mimetype='text/css')

@app.route('/script.js')
def js():
    """Serve JavaScript file"""
    return send_file('script.js', mimetype='application/javascript')

@app.route('/api/convert', methods=['POST'])
def convert():
    """Convert YouTube URL to MP3"""
    data = request.json
    if not data:
        return jsonify({'error': 'Invalid request data'}), 400
    
    url = data.get('url', '').strip()
    if not url:
        return jsonify({'error': 'URL is required'}), 400

    # Validate YouTube URL
    if 'youtube.com' not in url and 'youtu.be' not in url:
        return jsonify({'error': 'Invalid YouTube URL'}), 400

    # Get optional folder name and bitrate
    folder = data.get('folder', None)
    bitrate = str(data.get('bitrate', '64'))  # Default to 64 kbps, ensure string
    bitrate = bitrate.strip()
    
    # Validate bitrate (only allow 64 or 128)
    if bitrate not in ['64', '128']:
        bitrate = '64'
    if folder is not None:
        folder = str(folder).strip()
        if folder == '':
            folder = None

    # Sanitize folder name (same rules as create_folder)
    folder_name = None
    if folder:
        sanitized = "".join(c for c in folder if c.isalnum() or c in (' ', '-', '_')).strip()
        folder_name = sanitized if sanitized else None

    # Ensure folder exists if provided
    if folder_name:
        try:
            (DOWNLOADS_DIR / folder_name).mkdir(parents=True, exist_ok=True)
        except Exception as e:
            return jsonify({'error': f'Unable to create or access folder: {e}'}), 500

    # Generate unique file ID
    file_id = str(uuid.uuid4())

    # Start conversion in background thread and include folder name
    set_status(file_id, {'status': 'processing', 'folder': folder_name if folder_name else None})
    thread = threading.Thread(target=download_mp3, args=(url, file_id, folder_name, bitrate))
    thread.daemon = True
    thread.start()

    return jsonify({
        'file_id': file_id,
        'status': 'processing',
        'folder': folder_name
    })

@app.route('/api/status/<file_id>')
def status(file_id):
    """Check conversion status"""
    status_info = get_status(file_id)
    if status_info is None:
        return jsonify({'error': 'Invalid file ID'}), 404
    
    return jsonify(status_info)

@app.route('/api/download/<file_id>')
def download(file_id):
    """Download the converted MP3 file"""
    status_info = get_status(file_id)
    if status_info is None:
        return jsonify({'error': 'Invalid file ID'}), 404
    
    if status_info['status'] != 'completed':
        return jsonify({'error': 'File not ready'}), 400
    
    filename = status_info['filename']
    file_path = DOWNLOADS_DIR / filename
    
    if not file_path.exists():
        return jsonify({'error': 'File not found'}), 404
    
    # Extract clean filename (remove file_id prefix if present)
    from pathlib import Path as _Path
    clean_basename = _Path(filename).name
    clean_filename = clean_basename
    if '_' in clean_basename:
        parts = clean_basename.split('_', 1)
        if len(parts) == 2 and len(parts[0]) == 36:  # UUID length
            clean_filename = parts[1]
    
    return send_file(
        file_path,
        as_attachment=True,
        download_name=clean_filename,
        mimetype='audio/mpeg'
    )

@app.route('/api/cleanup/<file_id>', methods=['DELETE'])
def cleanup(file_id):
    """Clean up downloaded file"""
    status_info = get_status(file_id)
    if status_info:
        if 'filename' in status_info:
            file_path = DOWNLOADS_DIR / status_info['filename']
            if file_path.exists():
                file_path.unlink()
        delete_status(file_id)
    
    return jsonify({'success': True})

@app.route('/api/folders', methods=['GET'])
def list_folders():
    """List all folders"""
    folders = []
    if DOWNLOADS_DIR.exists():
        for item in DOWNLOADS_DIR.iterdir():
            if item.is_dir() and not item.name.startswith('.'):
                # Count files in folder
                mp3_count = len(list(item.glob("*.mp3")))
                folders.append({
                    'name': item.name,
                    'file_count': mp3_count
                })
    
    folders.sort(key=lambda x: x['name'].lower())
    return jsonify({'folders': folders})

@app.route('/api/folders', methods=['POST'])
def create_folder():
    """Create a new folder"""
    data = request.json
    folder_name = data.get('name', '').strip()
    
    if not folder_name:
        return jsonify({'error': 'Folder name is required'}), 400
    
    # Sanitize folder name
    folder_name = "".join(c for c in folder_name if c.isalnum() or c in (' ', '-', '_')).strip()
    
    if not folder_name:
        return jsonify({'error': 'Invalid folder name'}), 400
    
    folder_path = DOWNLOADS_DIR / folder_name
    
    if folder_path.exists():
        return jsonify({'error': 'Folder already exists'}), 400
    
    try:
        folder_path.mkdir(exist_ok=True)
        return jsonify({'success': True, 'name': folder_name})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/folders/<folder_name>', methods=['DELETE'])
def delete_folder(folder_name):
    """Delete a folder"""
    folder_path = DOWNLOADS_DIR / folder_name
    
    if not folder_path.exists() or not folder_path.is_dir():
        return jsonify({'error': 'Folder not found'}), 404
    
    try:
        # Remove all files in folder
        for file in folder_path.iterdir():
            if file.is_file():
                file.unlink()
            elif file.is_dir():
                shutil.rmtree(file)
        folder_path.rmdir()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/files')
def list_files():
    """List all downloaded MP3 files organized by folders"""
    folder_name = request.args.get('folder', None)
    result = {'folders': {}, 'root': []}
    
    if DOWNLOADS_DIR.exists():
        # List files in root directory
        for file_path in DOWNLOADS_DIR.glob("*.mp3"):
            filename = file_path.name
            
            # Skip browser-compatible versions
            if filename.startswith('browser_'):
                continue
            
            # Verify it's actually an MP3 file
            try:
                with open(file_path, 'rb') as f:
                    header = f.read(3)
                    if not (header.startswith(b'ID3') or header.startswith(b'\xff\xfb') or 
                           header.startswith(b'\xff\xf3') or header.startswith(b'\xff\xfa')):
                        continue
            except:
                continue
            
            stat = file_path.stat()
            clean_filename = filename
            if '_' in filename:
                parts = filename.split('_', 1)
                if len(parts) == 2 and len(parts[0]) == 36:
                    clean_filename = parts[1]
            
            result['root'].append({
                'filename': filename,
                'display_name': clean_filename,
                'size': stat.st_size,
                'modified': stat.st_mtime,
                'url': f'/api/play/{filename}',
                'download_url': f'/api/download-file/{filename}',
                'folder': None,
                'thumbnail': get_thumbnail_for_file(filename)
            })
        
        # List files in folders
        for item in DOWNLOADS_DIR.iterdir():
            if item.is_dir() and not item.name.startswith('.'):
                folder_files = []
                for file_path in item.glob("*.mp3"):
                    filename = file_path.name
                    
                    if filename.startswith('browser_'):
                        continue
                    
                    try:
                        with open(file_path, 'rb') as f:
                            header = f.read(3)
                            if not (header.startswith(b'ID3') or header.startswith(b'\xff\xfb') or 
                                   header.startswith(b'\xff\xf3') or header.startswith(b'\xff\xfa')):
                                continue
                    except:
                        continue
                    
                    stat = file_path.stat()
                    clean_filename = filename
                    if '_' in filename:
                        parts = filename.split('_', 1)
                        if len(parts) == 2 and len(parts[0]) == 36:
                            clean_filename = parts[1]
                    
                    folder_files.append({
                        'filename': filename,
                        'display_name': clean_filename,
                        'size': stat.st_size,
                        'modified': stat.st_mtime,
                        'url': f'/api/play/{item.name}/{filename}',
                        'download_url': f'/api/download-file/{item.name}/{filename}',
                        'folder': item.name,
                        'thumbnail': get_thumbnail_for_file(filename)
                    })
                
                if folder_files:
                    folder_files.sort(key=lambda x: x['modified'], reverse=True)
                    result['folders'][item.name] = folder_files
        
        # Sort root files
        result['root'].sort(key=lambda x: x['modified'], reverse=True)
    
    # If folder filter is specified, return only that folder
    if folder_name:
        if folder_name in result['folders']:
            return jsonify({'files': result['folders'][folder_name]})
        else:
            return jsonify({'files': []})
    
    return jsonify(result)

@app.route('/api/play/<path:filename>')
def play_file(filename):
    """Serve audio file for playback with range request support"""
    from flask import Response, request
    import urllib.parse
    
    # Decode URL-encoded filename
    try:
        filename = urllib.parse.unquote(filename)
    except:
        pass
    
    # Check if filename includes folder path
    folder_name = None
    actual_filename = filename
    if '/' in filename:
        parts = filename.split('/', 1)
        folder_name = parts[0]
        actual_filename = parts[1]
        file_path = DOWNLOADS_DIR / folder_name / actual_filename
        compatible_path = DOWNLOADS_DIR / folder_name / f"browser_{actual_filename}"
    else:
        file_path = DOWNLOADS_DIR / filename
        compatible_path = DOWNLOADS_DIR / f"browser_{filename}"
    
    if not file_path.exists():
        return jsonify({'error': 'File not found'}), 404
    
    # Check if file already has "browser_" prefix - if so, use it directly
    if actual_filename.startswith('browser_'):
        serve_path = file_path
    else:
        # Check if browser-compatible version exists, if not try to create it
        
        # Try to re-encode if browser version doesn't exist
        if not compatible_path.exists():
            print(f"Re-encoding {filename} for browser compatibility...")
            if reencode_mp3_for_browser(file_path, compatible_path):
                print(f"Successfully created browser-compatible version")
                serve_path = compatible_path
            else:
                print(f"Re-encoding failed, using original file")
                serve_path = file_path
        else:
            # Use browser-compatible version if it exists
            serve_path = compatible_path
    
    # Always use MP3 MIME type
    mime_type = 'audio/mpeg'
    
    # Get file size
    file_size = serve_path.stat().st_size
    
    # Handle range requests for audio streaming (required for HTML5 audio)
    range_header = request.headers.get('Range', None)
    
    if range_header:
        try:
            # Parse range header
            byte_start = 0
            byte_end = file_size - 1
            
            range_match = range_header.replace('bytes=', '').split('-')
            if range_match[0]:
                byte_start = int(range_match[0])
            if range_match[1]:
                byte_end = int(range_match[1])
            else:
                byte_end = file_size - 1
            
            # Ensure valid range
            if byte_start < 0:
                byte_start = 0
            if byte_end >= file_size:
                byte_end = file_size - 1
            if byte_start > byte_end:
                byte_start = 0
                byte_end = file_size - 1
            
            length = byte_end - byte_start + 1
            
            with open(serve_path, 'rb') as f:
                f.seek(byte_start)
                data = f.read(length)
            
            response = Response(
                data,
                206,  # Partial Content
                mimetype=mime_type,
                headers={
                    'Content-Range': f'bytes {byte_start}-{byte_end}/{file_size}',
                    'Accept-Ranges': 'bytes',
                    'Content-Length': str(length),
                    'Cache-Control': 'public, max-age=3600',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Range',
                    'Content-Type': mime_type
                },
                direct_passthrough=True
            )
            return response
        except Exception as e:
            print(f"Error handling range request: {e}")
            # Fall through to full file response
    
    # Full file response
    response = send_file(
        serve_path,
        mimetype=mime_type,
        conditional=True
    )
    response.headers['Accept-Ranges'] = 'bytes'
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Content-Type'] = mime_type
    return response

@app.route('/api/download-file/<path:filename>')
def download_file_by_name(filename):
    """Download file by filename (supports folder paths)"""
    import urllib.parse
    try:
        filename = urllib.parse.unquote(filename)
    except:
        pass

    file_path = DOWNLOADS_DIR / filename
    if not file_path.exists():
        return jsonify({'error': 'File not found'}), 404

    # Extract clean filename from basename
    from pathlib import Path as _Path
    clean_basename = _Path(filename).name
    clean_filename = clean_basename
    if '_' in clean_basename:
        parts = clean_basename.split('_', 1)
        if len(parts) == 2 and len(parts[0]) == 36:  # UUID length
            clean_filename = parts[1]

    return send_file(
        file_path,
        as_attachment=True,
        download_name=clean_filename,
        mimetype='audio/mpeg'
    )

@app.route('/api/delete-file/<path:filename>', methods=['DELETE'])
def delete_file(filename):
    """Delete a file from downloads"""
    # Check if filename includes folder path
    if '/' in filename:
        parts = filename.split('/', 1)
        folder_name = parts[0]
        filename = parts[1]
        file_path = DOWNLOADS_DIR / folder_name / filename
        browser_path = DOWNLOADS_DIR / folder_name / f"browser_{filename}"
    else:
        file_path = DOWNLOADS_DIR / filename
        browser_path = DOWNLOADS_DIR / f"browser_{filename}"
    if not file_path.exists():
        return jsonify({'error': 'File not found'}), 404
    
    try:
        file_path.unlink()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Find FFmpeg and update PATH before starting server
    ffmpeg_path = find_ffmpeg_path()
    if ffmpeg_path:
        if ffmpeg_path not in os.environ.get('PATH', ''):
            os.environ['PATH'] = ffmpeg_path + os.pathsep + os.environ.get('PATH', '')
        print(f"FFmpeg found at: {ffmpeg_path}")
    else:
        print("Warning: FFmpeg not found in PATH. Trying to locate...")

    # Read port from environment (Render sets $PORT)
    port = int(os.environ.get('PORT', 5000))
    # Bind to all interfaces for container environments
    app.run(host='0.0.0.0', port=port, debug=False, use_reloader=False)


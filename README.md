# YouTube to MP3 Converter

A beautiful and fully functional web application that converts YouTube videos to MP3 format and allows users to download them.

## Live Link : https://ytmp3-sp.onrender.com/

## Features

- 🎵 Convert YouTube videos to MP3 format
- 📥 Download converted files directly to your device
- 🎨 Modern and responsive UI
- ⚡ Fast and efficient conversion
- 🔄 Real-time progress tracking
- 📱 **Progressive Web App (PWA)** - Install as native app on any device
- 🔌 **Offline Support** - Access cached content when offline
- ⚙️ **Service Worker** - Smart caching for fast performance

## 🆕 PWA Features

TuneVerse is now a **Progressive Web App**! Install it on your device like a native application:
- **Home screen icons** on mobile & desktop
- **Offline playback** of downloaded music
- **Smart caching** for instant loading
- **Native app feel** with full-screen mode

See [PWA_SETUP.md](PWA_SETUP.md) for detailed installation and usage instructions.

## Prerequisites

- Python 3.7 or higher
- FFmpeg (required for audio conversion)

### Installing FFmpeg

**Windows:**
1. Download FFmpeg from https://ffmpeg.org/download.html
2. Extract and add to your system PATH
3. Or use chocolatey: `choco install ffmpeg`

**macOS:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

## Installation

1. Clone or download this repository

2. Install Python dependencies:
```bash
pip install -r requirements.txt
```

## Usage

1. Start the Flask server:
```bash
python app.py
```

2. Open your web browser and navigate to:
```
http://localhost:5000
```

3. Paste a YouTube URL in the input field

4. Click "Convert" and wait for the conversion to complete

5. Click "Download MP3" to save the file to your device

## How It Works

- The frontend sends the YouTube URL to the backend API
- The backend uses `yt-dlp` to download the video
- FFmpeg extracts and converts the audio to MP3 format
- The converted file is served for download
- Files are automatically cleaned up after download

## Project Structure

```
ytmp3/
├── app.py              # Flask backend server
├── index.html          # Frontend HTML
├── style.css           # Styling
├── script.js           # Frontend JavaScript
├── requirements.txt    # Python dependencies
├── README.md          # This file
└── downloads/         # Temporary storage for converted files (created automatically)
```

## Notes

- Converted files are stored temporarily in the `downloads/` directory
- Files are automatically cleaned up after download
- The server runs on port 5000 by default
- Make sure FFmpeg is installed and accessible in your system PATH

## Troubleshooting

**Conversion fails:**
- Ensure FFmpeg is installed and in your PATH
- Check that the YouTube URL is valid
- Make sure you have internet connection

**Server won't start:**
- Check if port 5000 is already in use
- Ensure all dependencies are installed: `pip install -r requirements.txt`

**Download doesn't work:**
- Check browser console for errors
- Ensure the server is running
- Try a different browser

## License

This project is for educational purposes. Please respect YouTube's Terms of Service and copyright laws when using this tool.


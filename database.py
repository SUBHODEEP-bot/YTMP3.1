import os
import logging
from supabase import create_client, Client
from dotenv import load_dotenv
import time

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)

class SupabaseManager:
    def __init__(self):
        self.url = os.getenv("SUPABASE_URL")
        self.key = os.getenv("SUPABASE_KEY")
        self.bucket_name = "yt-downloads"
        
        if not self.url or not self.key:
            logger.error("❌ Supabase credentials not found!")
            self.supabase = None
            return
        
        try:
            self.supabase: Client = create_client(self.url, self.key)
            logger.info("✅ Supabase connected successfully!")
        except Exception as e:
            logger.error(f"❌ Failed to connect to Supabase: {e}")
            self.supabase = None

    # --- STORAGE METHODS (ঠিক করা ভার্সন) ---
    
    def upload_file(self, local_file_path: str, file_name: str):
        """
        লোকাল ফাইলটি সুপাবেস স্টোরেজে আপলোড করবে
        """
        if self.supabase is None:
            logger.error("Supabase client not initialized")
            return None
        
        try:
            # ফাইল পড়া
            with open(local_file_path, 'rb') as f:
                file_content = f.read()
            
            # Supabase Storage-এ আপলোড (নতুন ভার্সন)
            from supabase.lib.storage import StorageException
            
            try:
                # Create the storage object
                storage = self.supabase.storage
                
                # Upload the file
                response = storage.from_(self.bucket_name).upload(
                    file=file_content,
                    path=file_name,
                    file_options={
                        "content-type": "audio/mpeg",
                        "cache-control": "3600"
                    }
                )
                
                # Get public URL
                file_url = storage.from_(self.bucket_name).get_public_url(file_name)
                logger.info(f"✅ File uploaded successfully: {file_url}")
                return file_url
                
            except StorageException as e:
                logger.error(f"❌ Storage upload error: {e}")
                
                # Alternative method: Try using requests directly
                try:
                    import requests
                    
                    # Get upload URL
                    upload_url = f"{self.url}/storage/v1/object/{self.bucket_name}/{file_name}"
                    
                    headers = {
                        'Authorization': f'Bearer {self.key}',
                        'Content-Type': 'audio/mpeg'
                    }
                    
                    # Upload using requests
                    with open(local_file_path, 'rb') as f:
                        upload_response = requests.post(
                            upload_url,
                            headers=headers,
                            data=f.read()
                        )
                    
                    if upload_response.status_code == 200:
                        file_url = f"{self.url}/storage/v1/object/public/{self.bucket_name}/{file_name}"
                        logger.info(f"✅ File uploaded via direct API: {file_url}")
                        return file_url
                    else:
                        logger.error(f"❌ Direct upload failed: {upload_response.status_code}, {upload_response.text}")
                        return None
                        
                except Exception as direct_error:
                    logger.error(f"❌ Direct upload also failed: {direct_error}")
                    return None
                    
        except Exception as e:
            logger.error(f"❌ General upload error: {e}")
            return None

    def delete_file_from_storage(self, file_path: str):
        """Delete file from Supabase storage"""
        if self.supabase is None:
            return False
        
        try:
            storage = self.supabase.storage
            response = storage.from_(self.bucket_name).remove([file_path])
            return True
        except Exception as e:
            logger.error(f"Error deleting from storage: {e}")
            return False

    # --- DATABASE METHODS ---

    def save_song(self, song_data: dict):
        """Save song metadata to Supabase table"""
        if self.supabase is None:
            logger.error("Supabase client not initialized")
            return None
        
        try:
            # Insert into 'conversions' table
            response = self.supabase.table("conversions").insert(song_data).execute()
            
            if hasattr(response, 'data') and response.data:
                logger.info(f"✅ Song metadata saved to DB with ID: {response.data[0]['id']}")
                return response.data[0]
            else:
                logger.error("❌ Failed to save metadata to DB")
                return None
                
        except Exception as e:
            logger.error(f"❌ Error saving to Supabase: {e}")
            return None

    def update_song(self, file_id: str, update_data: dict):
        """Update song metadata in Supabase"""
        if self.supabase is None:
            return False
        
        try:
            response = self.supabase.table("conversions").update(update_data).eq('file_id', file_id).execute()
            return bool(response.data)
        except Exception as e:
            logger.error(f"Error updating song in Supabase: {e}")
            return False

    def get_song(self, file_id: str):
        """Get song metadata from Supabase"""
        if self.supabase is None:
            return None
        
        try:
            response = self.supabase.table("conversions").select("*").eq('file_id', file_id).execute()
            return response.data[0] if response.data else None
        except Exception as e:
            logger.error(f"Error getting song from Supabase: {e}")
            return None

    def get_user_songs(self, client_id: str):
        """Get all songs for a user from Supabase"""
        if self.supabase is None:
            return []
        
        try:
            response = self.supabase.table("conversions").select("*").eq('client_id', client_id).order('created_at', desc=True).execute()
            return response.data
        except Exception as e:
            logger.error(f"Error getting user songs from Supabase: {e}")
            return []

    def delete_song(self, file_id: str):
        """Delete song from database and storage"""
        if self.supabase is None:
            return False
        
        try:
            # First get the song data to find storage path
            song = self.get_song(file_id)
            if song and song.get('file_path'):
                # Delete from storage
                self.delete_file_from_storage(song['file_path'])
            
            # Delete from database
            response = self.supabase.table("conversions").delete().eq('file_id', file_id).execute()
            return True
        except Exception as e:
            logger.error(f"Error deleting song: {e}")
            return False

    def health_check(self):
        """Check Supabase connection"""
        if self.supabase is None:
            return False
        
        try:
            self.supabase.table("conversions").select("*").limit(1).execute()
            return True
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return False

# Create global instance
db = SupabaseManager()
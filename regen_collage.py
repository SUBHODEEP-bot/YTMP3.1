from app import generate_collage_for_folder
from PIL import Image
from pathlib import Path

folder = 'kishore kumar bengali'
path = generate_collage_for_folder(folder, max_tiles=9, size=360)
print('collage path:', path)
if path:
	p = Path(path)
	if p.exists():
		im = Image.open(p)
		print('format:', im.format, 'size:', im.size, 'mode:', im.mode, 'bytes:', p.stat().st_size)
	else:
		print('file not found on disk')

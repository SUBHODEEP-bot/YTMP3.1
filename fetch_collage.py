import requests
url='http://127.0.0.1:5000/api/folder_collage?folder=kishore%20kumar%20bengali'
try:
    r=requests.get(url, timeout=10)
    print('status:', r.status_code)
    print('content-type:', r.headers.get('Content-Type'))
    print('content-length header:', r.headers.get('Content-Length'))
    print('len content bytes:', len(r.content))
    with open('debug_collage.jpg','wb') as f:
        f.write(r.content)
    print('saved debug_collage.jpg')
except Exception as e:
    print('error:', e)

import os
import json
import urllib.request
import urllib.error

print(f"API Key set: {bool(os.environ.get('GOOGLE_API_KEY'))}")

req = urllib.request.Request(
    'http://127.0.0.1:4000/api/pipeline/process',
    data=json.dumps({
        'files': [{
            'fileName': 'test.png',
            'mimeType': 'image/png',
            'fileBase64': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
        }]
    }).encode('utf-8'),
    headers={'Content-Type': 'application/json'}
)

try:
    with urllib.request.urlopen(req) as r:
        print(f'Status: {r.status}')
        print(r.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print(f'Status: {e.code}')
    print(e.read().decode('utf-8'))
except Exception as e:
    print(f'Error: {e}')

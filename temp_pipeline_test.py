import json
import urllib.request
import urllib.error

url = 'http://127.0.0.1:4000/api/pipeline/process'
payload = {
    'files': [
        {
            'fileName': 'test.png',
            'mimeType': 'image/png',
            'fileBase64': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
        }
    ]
}

req = urllib.request.Request(
    url,
    data=json.dumps(payload).encode('utf-8'),
    headers={'Content-Type': 'application/json'},
)
try:
    with urllib.request.urlopen(req) as r:
        print('status', r.status)
        print(r.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print('status', e.code)
    print(e.read().decode('utf-8'))
except Exception as e:
    print('error', str(e))

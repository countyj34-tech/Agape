import json
import urllib.request
import urllib.error

url = 'http://127.0.0.1:4000/api/pipeline/process'
payload = {
    'files': [
        {
            'fileName': 'test.png',
            'mimeType': 'image/png',
            'fileBase64': '',
        }
    ]
}

req = urllib.request.Request(
    url,
    data=json.dumps(payload).encode('utf-8'),
    headers={'Content-Type': 'application/json'},
)

try:
    with urllib.request.urlopen(req) as resp:
        print('status', resp.status)
        print(resp.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print('status', e.code)
    print(e.read().decode('utf-8'))
except Exception as exc:
    print('err', exc)

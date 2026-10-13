import os, subprocess, sys
os.makedirs(r'C:\Temp', exist_ok=True)
cmd = [sys.executable, '-m', 'pip', 'install', '--target', r'C:\Users\stephan\AppData\Roaming\Python\Python314\site-packages', '--no-cache-dir', 'fastapi']
env = os.environ.copy()
env['TMP'] = r'C:\Temp'
env['TEMP'] = r'C:\Temp'
print('RUNNING', cmd)
proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
print('RC', proc.returncode)
print('STDOUT', proc.stdout)
print('STDERR', proc.stderr)

import os, subprocess, sys
os.makedirs(r'D:\Temp', exist_ok=True)
env = os.environ.copy()
env['TMP'] = r'D:\Temp'
env['TEMP'] = r'D:\Temp'
env['TMPDIR'] = r'D:\Temp'
env['PIP_CACHE_DIR'] = r'D:\Temp'
print('env TMP', env['TMP'])
print('env TEMP', env['TEMP'])
print('env TMPDIR', env['TMPDIR'])
print('env PIP_CACHE_DIR', env['PIP_CACHE_DIR'])
cmd = [sys.executable, '-m', 'pip', 'install', 'PyMuPDF', '--no-cache-dir']
print('RUNNING', cmd)
proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
print('DONE RC', proc.returncode)
print('STDOUT LEN', len(proc.stdout))
print('STDERR LEN', len(proc.stderr))
print('STDOUT REPR', repr(proc.stdout[:2000]))
print('STDERR REPR', repr(proc.stderr[:2000]))

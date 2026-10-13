import os, subprocess, sys
os.makedirs(r'C:\Temp', exist_ok=True)
env = os.environ.copy()
env['TMP'] = r'C:\Temp'
env['TEMP'] = r'C:\Temp'
env['TMPDIR'] = r'C:\Temp'
print('env TMP', env['TMP'])
print('env TEMP', env['TEMP'])
print('env TMPDIR', env.get('TMPDIR'))
cmd = [sys.executable, '-m', 'pip', 'install', 'PyMuPDF', '--no-cache-dir']
print('RUNNING', cmd)
proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
print('DONE RC', proc.returncode)
print('STDOUT LEN', len(proc.stdout))
print('STDERR LEN', len(proc.stderr))
print('STDOUT REPR', repr(proc.stdout[:2000]))
print('STDERR REPR', repr(proc.stderr[:2000]))

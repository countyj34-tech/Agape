import os, subprocess, sys
os.makedirs(r'D:\Temp', exist_ok=True)
log_path = r'D:\Temp\pymupdf_install_log.txt'
env = os.environ.copy()
env['TMP'] = r'D:\Temp'
env['TEMP'] = r'D:\Temp'
env['TMPDIR'] = r'D:\Temp'
env['PIP_CACHE_DIR'] = r'D:\Temp'
cmd = [sys.executable, '-m', 'pip', 'install', 'PyMuPDF', '--no-cache-dir']
with open(log_path, 'w', encoding='utf-8', errors='replace') as f:
    f.write(f'RUNNING {cmd}\n')
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
    f.write(f'RC {proc.returncode}\n')
    f.write('STDOUT:\n')
    f.write(proc.stdout)
    f.write('\nSTDERR:\n')
    f.write(proc.stderr)
print('WROTE', log_path)

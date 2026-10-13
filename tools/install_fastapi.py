import subprocess, sys
cmd = [sys.executable, '-m', 'pip', 'install', '--user', '--no-cache-dir', 'fastapi']
print('RUNNING:', cmd)
proc = subprocess.run(cmd, capture_output=True, text=True)
print('RETURNCODE', proc.returncode)
print('STDOUT:\n', repr(proc.stdout))
print('STDERR:\n', repr(proc.stderr))
print('--- verifying fastapi ---')
proc2 = subprocess.run([sys.executable, '-m', 'pip', 'show', 'fastapi'], capture_output=True, text=True)
print('SHOW RETURNCODE', proc2.returncode)
print('SHOW STDOUT:\n', repr(proc2.stdout))
print('SHOW STDERR:\n', repr(proc2.stderr))

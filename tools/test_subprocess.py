import subprocess, sys
print('RUNNING')
proc = subprocess.run([sys.executable, '-c', "print('HELLO')"], capture_output=True, text=True)
print('RC', proc.returncode)
print('STDOUT', proc.stdout)
print('STDERR', proc.stderr)

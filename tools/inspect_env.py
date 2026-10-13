import sys, site
print(sys.executable)
print(sys.version)
print(site.getusersitepackages())
print('sys.path:')
for p in sys.path:
    print(p)

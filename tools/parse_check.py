import ast, traceback, pathlib, sys
p = pathlib.Path('server/app.py')
text = p.read_text()
try:
    ast.parse(text)
    print('PARSE OK')
except Exception:
    traceback.print_exc()
    sys.exit(2)

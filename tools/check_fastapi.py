import importlib.util
spec = importlib.util.find_spec('fastapi')
print('fastapi spec:', spec)
if spec:
    import fastapi
    print('fastapi file:', fastapi.__file__)

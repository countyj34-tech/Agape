import google.generativeai as genai

print('module:', genai)
print('file:', getattr(genai, '__file__', '<none>'))
print('has responses:', hasattr(genai, 'responses'))
print('has configure:', hasattr(genai, 'configure'))
print('has GenerativeModel:', hasattr(genai, 'GenerativeModel'))
print('has generate:', hasattr(genai, 'generate'))
print('has generate_text:', hasattr(genai, 'generate_text'))
print('has Client:', hasattr(genai, 'Client'))
print('has types:', hasattr(genai, 'types'))
print('available top-level names:', [name for name in dir(genai) if name in ('responses', 'configure', 'GenerativeModel', 'generate', 'generate_text', 'Client', 'types', 'BlobDict', 'ContentDict', 'GenerationConfigDict')])

"""
Entrypoint do Vercel.

O Vercel procura a aplicação Flask em caminhos específicos (api/index.py é um
deles). Aqui apenas importamos o app real, que vive em Backend/app.py, e o
expomos na variável `app` para o runtime serverless.
"""

import os
import sys

# Coloca a raiz do projeto e a pasta Backend no PYTHONPATH
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, 'Backend'))

from app import app  # noqa: E402  (Vercel usa esta variável como handler WSGI)

# Cria as tabelas (idempotente). Se o banco não estiver acessível no cold start,
# não derruba a função — apenas registra o erro.
try:
    from app import init_app
    init_app()
except Exception as exc:  # pragma: no cover
    print(f"[Vercel] init_app falhou no cold start: {exc}")

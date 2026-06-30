import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(file)), 'backend'))

from app import app, init_app

init_app()

if name == 'main':
    debug = os.getenv('FLASK_DEBUG', '0') == '1'
    app.run(debug=debug, port=5000, threaded=True)
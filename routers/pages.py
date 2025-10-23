"""
Page route handlers
"""
from flask import render_template


def register_page_routes(app):
    """Register page routes with the Flask app"""

    @app.route('/')
    def index():
        """Serve the simple interface"""
        return render_template('index.html')

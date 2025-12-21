"""
FastAPI page route handlers
"""
from fastapi import Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

# Initialize Jinja2 templates
templates = Jinja2Templates(directory="templates")


def register_page_routes(app):
    """Register page routes with the FastAPI app"""

    @app.get("/", response_class=HTMLResponse, tags=["Pages"])
    async def index(request: Request):
        """Serve the main interface"""
        return templates.TemplateResponse("index.html", {"request": request})

    @app.get("/audio-test", response_class=HTMLResponse, tags=["Pages"])
    async def audio_test(request: Request):
        """Audio capture diagnostic test page"""
        return templates.TemplateResponse("audio_test.html", {"request": request})

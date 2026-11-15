"""Koya's six assessment endpoints, with consistent JSON errors."""
import hmac
import json
from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import text
from starlette.exceptions import HTTPException
from .config import Settings
from .database import make_session_factory
from .schemas import BookingOutput, BookingPage, ResetInput, SlotList
from . import services


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    factory = make_session_factory(settings)
    app = FastAPI(title="Clinic Booking API", version="1.0", docs_url=None, redoc_url=None,
                  openapi_url=None)
    app.state.session_factory = factory

    def authenticate(request: Request):
        supplied = request.headers.get("X-API-Key", "")
        if not hmac.compare_digest(supplied.encode(), settings.api_key.encode()):
            raise HTTPException(401, "invalid API key")

    router = APIRouter(dependencies=[Depends(authenticate)])

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return JSONResponse({"error": str(exc.detail)}, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse({"error": "invalid request"}, status_code=400)

    @app.exception_handler(Exception)
    async def unexpected_error(request, exc):
        # Do not echo SQL, credentials, patient details or stack traces to clients.
        return JSONResponse({"error": "internal server error"}, status_code=500)

    def response(result):
        status, body, headers = result
        return JSONResponse(jsonable_encoder(body), status_code=status, headers=headers)

    async def read_json(request):
        try:
            return await request.json()
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise HTTPException(400, "invalid JSON")

    @router.post("/reset")
    async def replace_slots(request: Request):
        raw = await read_json(request)
        try:
            details = ResetInput.model_validate(raw)
        except ValidationError:
            raise HTTPException(400, "invalid slots")
        # Offload synchronous PostgreSQL work from the async event loop.
        from starlette.concurrency import run_in_threadpool
        await run_in_threadpool(services.reset, factory, details)
        return {"ok": True}

    @router.get("/slots", response_model=SlotList)
    def slots():
        return services.list_slots(factory)

    @router.post("/bookings", response_model=BookingOutput, status_code=201)
    async def book(request: Request):
        raw = await read_json(request)
        from starlette.concurrency import run_in_threadpool
        return response(await run_in_threadpool(services.create_booking, factory, raw,
                                               request.headers.get("Idempotency-Key")))

    @router.get("/bookings", response_model=BookingPage)
    def bookings(request: Request):
        email = request.query_params.get("email", "").strip()
        if not email:
            raise HTTPException(400, "email is required")
        raw_limit = request.query_params.get("limit", "10")
        try:
            if not raw_limit.isascii() or not raw_limit.isdecimal():
                raise ValueError
            limit = int(raw_limit)
            if not 1 <= limit <= 50:
                raise ValueError
            return services.list_bookings(factory, email, limit, request.query_params.get("cursor"),
                                          settings.cursor_secret)
        except ValueError:
            raise HTTPException(400, "invalid limit or cursor")

    @router.get("/bookings/{id}", response_model=BookingOutput)
    def booking(id: str):
        return response(services.get_booking(factory, id))

    @router.delete("/bookings/{id}", response_model=BookingOutput)
    def cancel(id: str):
        return response(services.cancel_booking(factory, id))

    @router.get("/health")
    def health():
        with factory() as session:
            session.execute(text("SELECT 1"))
        return {"status": "ok"}

    app.include_router(router)
    return app

from __future__ import annotations

import json

from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .security import (
    SESSION_GENERATION_KEY,
    authenticate_password,
    get_client_ip,
    get_security_snapshot,
    session_is_authorized,
)


def _json_body(request: HttpRequest) -> dict[str, object] | None:
    try:
        value = json.loads(request.body or b"{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return value if isinstance(value, dict) else None


@require_GET
@ensure_csrf_cookie
def auth_status(request: HttpRequest) -> JsonResponse:
    snapshot = get_security_snapshot()
    authorized = session_is_authorized(request.session, snapshot)
    status = 423 if snapshot.locked else 200
    return JsonResponse(
        {
            "authorized": authorized,
            "locked": snapshot.locked,
        },
        status=status,
    )


@require_POST
def login(request: HttpRequest) -> JsonResponse:
    payload = _json_body(request)
    if payload is None or not isinstance(payload.get("password"), str):
        return JsonResponse({"error": "请求格式不正确"}, status=400)
    password = payload["password"]
    if len(password) > 1024:
        return JsonResponse({"error": "密码长度不正确"}, status=400)

    result = authenticate_password(password, get_client_ip(request.META))
    if result.locked:
        request.session.flush()
        return JsonResponse(
            {"authorized": False, "locked": True, "error": "服务器已锁定，请联系运维重置密码"},
            status=423,
        )
    if not result.authorized:
        return JsonResponse(
            {
                "authorized": False,
                "locked": False,
                "error": "密码错误",
                "remainingDailyAttempts": result.remaining_daily_attempts,
                "remainingIpAttempts": result.remaining_ip_attempts,
            },
            status=401,
        )

    request.session.cycle_key()
    request.session[SESSION_GENERATION_KEY] = result.generation
    request.session.set_expiry(0)
    return JsonResponse({"authorized": True, "locked": False})


@require_POST
def logout(request: HttpRequest) -> JsonResponse:
    request.session.flush()
    return JsonResponse({"authorized": False})


@require_GET
def health(request: HttpRequest) -> JsonResponse:
    snapshot = get_security_snapshot()
    return JsonResponse({"ok": True, "locked": snapshot.locked})


from __future__ import annotations

import ipaddress
import logging
import secrets
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac

from .models import IpAttempt, SecurityState


SESSION_GENERATION_KEY = "cloudrop_security_generation"
SECURITY_GROUP = "cloudrop.security"
logger = logging.getLogger(__name__)
sqlite_security_lock = threading.RLock()


@dataclass(frozen=True)
class SecuritySnapshot:
    locked: bool
    generation: int
    daily_failures: int


@dataclass(frozen=True)
class AuthenticationResult:
    authorized: bool
    locked: bool
    generation: int
    remaining_daily_attempts: int
    remaining_ip_attempts: int


@contextmanager
def _security_transaction() -> Iterator[None]:
    if connection.vendor == "sqlite":
        with sqlite_security_lock:
            with transaction.atomic():
                yield
        return
    with transaction.atomic():
        yield


def password_fingerprint(password: str) -> str:
    return salted_hmac(
        "cloudrop.access-password",
        password,
        secret=settings.SECRET_KEY,
        algorithm="sha256",
    ).hexdigest()


def _state_for_update() -> SecurityState:
    today = timezone.localdate()
    fingerprint = password_fingerprint(settings.CLOUDROP_ACCESS_PASSWORD)
    state, _ = SecurityState.objects.select_for_update().get_or_create(
        pk=1,
        defaults={
            "password_fingerprint": fingerprint,
            "failure_day": today,
        },
    )

    changed_fields: list[str] = []
    if state.password_fingerprint != fingerprint:
        state.password_fingerprint = fingerprint
        state.failure_day = today
        state.daily_failures = 0
        state.locked = False
        state.generation += 1
        IpAttempt.objects.all().delete()
        changed_fields = [
            "password_fingerprint",
            "failure_day",
            "daily_failures",
            "locked",
            "generation",
            "updated_at",
        ]
    elif not state.locked and state.failure_day != today:
        state.failure_day = today
        state.daily_failures = 0
        changed_fields = ["failure_day", "daily_failures", "updated_at"]

    if changed_fields:
        state.save(update_fields=changed_fields)
    return state


def get_security_snapshot() -> SecuritySnapshot:
    with _security_transaction():
        state = _state_for_update()
        return SecuritySnapshot(
            locked=state.locked,
            generation=state.generation,
            daily_failures=state.daily_failures,
        )


def session_is_authorized(session: object, snapshot: SecuritySnapshot | None = None) -> bool:
    if snapshot is None:
        snapshot = get_security_snapshot()
    if snapshot.locked:
        return False
    try:
        generation = session.get(SESSION_GENERATION_KEY)  # type: ignore[attr-defined]
    except AttributeError:
        return False
    return generation == snapshot.generation


def websocket_authorization(session: object) -> tuple[bool, bool]:
    snapshot = get_security_snapshot()
    return session_is_authorized(session, snapshot), snapshot.locked


def authenticate_password(candidate: str, ip_address: str) -> AuthenticationResult:
    became_locked = False
    with _security_transaction():
        state = _state_for_update()
        if state.locked:
            return AuthenticationResult(False, True, state.generation, 0, 0)

        attempt, _ = IpAttempt.objects.select_for_update().get_or_create(
            ip_address=ip_address,
            defaults={"consecutive_failures": 0},
        )

        if secrets.compare_digest(candidate, settings.CLOUDROP_ACCESS_PASSWORD):
            if attempt.consecutive_failures:
                attempt.consecutive_failures = 0
                attempt.save(update_fields=["consecutive_failures", "updated_at"])
            return AuthenticationResult(
                True,
                False,
                state.generation,
                max(0, settings.CLOUDROP_DAILY_FAILURE_LIMIT - state.daily_failures),
                settings.CLOUDROP_IP_FAILURE_LIMIT,
            )

        state.daily_failures += 1
        attempt.consecutive_failures += 1
        if (
            state.daily_failures >= settings.CLOUDROP_DAILY_FAILURE_LIMIT
            or attempt.consecutive_failures >= settings.CLOUDROP_IP_FAILURE_LIMIT
        ):
            state.locked = True
            state.generation += 1
            became_locked = True

        state.save(update_fields=["daily_failures", "locked", "generation", "updated_at"])
        attempt.save(update_fields=["consecutive_failures", "updated_at"])
        result = AuthenticationResult(
            False,
            state.locked,
            state.generation,
            max(0, settings.CLOUDROP_DAILY_FAILURE_LIMIT - state.daily_failures),
            max(0, settings.CLOUDROP_IP_FAILURE_LIMIT - attempt.consecutive_failures),
        )

    if became_locked:
        channel_layer = get_channel_layer()
        if channel_layer is not None:
            try:
                async_to_sync(channel_layer.group_send)(
                    SECURITY_GROUP,
                    {"type": "server.locked"},
                )
            except Exception:
                logger.exception("Server locked, but the WebSocket lock broadcast failed")
    return result


def get_client_ip(meta: dict[str, str]) -> str:
    remote = meta.get("REMOTE_ADDR", "127.0.0.1")
    trusted_proxy_count = max(0, settings.CLOUDROP_TRUSTED_PROXY_COUNT)
    forwarded = meta.get("HTTP_X_FORWARDED_FOR", "")
    if trusted_proxy_count and forwarded:
        parts = [part.strip() for part in forwarded.split(",") if part.strip()]
        if len(parts) >= trusted_proxy_count:
            remote = parts[-trusted_proxy_count]
    try:
        return str(ipaddress.ip_address(remote))
    except ValueError:
        return "127.0.0.1"

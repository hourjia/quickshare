from __future__ import annotations

import os
import sys
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured


BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


def redis_host_config(address: str) -> dict[str, str | None]:
    return {
        "address": address,
        "socket_timeout": None,
        "socket_connect_timeout": None,
    }


TESTING = (
    env_bool("CLOUDROP_TESTING", False)
    or "test" in sys.argv
    or "pytest" in str(Path(sys.argv[0])).lower()
)
DEBUG = env_bool("DJANGO_DEBUG", False)

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if TESTING:
        SECRET_KEY = "cloudrop-test-secret-key"
    elif DEBUG:
        SECRET_KEY = "cloudrop-development-only-secret-key"
    else:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY is required when DJANGO_DEBUG is false")

CLOUDROP_ACCESS_PASSWORD = os.getenv("CLOUDROP_ACCESS_PASSWORD")
if not CLOUDROP_ACCESS_PASSWORD:
    if TESTING:
        CLOUDROP_ACCESS_PASSWORD = "test-password"
    else:
        raise ImproperlyConfigured("CLOUDROP_ACCESS_PASSWORD is required")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")
if DEBUG:
    CSRF_TRUSTED_ORIGINS.extend(
        origin
        for origin in ("http://127.0.0.1:5173", "http://localhost:5173")
        if origin not in CSRF_TRUSTED_ORIGINS
    )

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.staticfiles",
    "channels",
    "transfer",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
]

ROOT_URLCONF = "cloudrop.urls"
ASGI_APPLICATION = "cloudrop.asgi.application"

TEMPLATES: list[dict[str, object]] = []
WSGI_APPLICATION = "cloudrop.wsgi.application"

DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=60,
        conn_health_checks=True,
    )
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Asia/Shanghai"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"

SESSION_COOKIE_NAME = "cloudrop_session"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = env_bool("DJANGO_SECURE_COOKIES", not DEBUG)
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
SESSION_SAVE_EVERY_REQUEST = False

CSRF_COOKIE_NAME = "cloudrop_csrf"
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = env_bool("DJANGO_SECURE_COOKIES", not DEBUG)
CSRF_COOKIE_HTTPONLY = False

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"

CLOUDROP_TRUSTED_PROXY_COUNT = int(os.getenv("CLOUDROP_TRUSTED_PROXY_COUNT", "1"))
CLOUDROP_DAILY_FAILURE_LIMIT = 10
CLOUDROP_IP_FAILURE_LIMIT = 5
CLOUDROP_PAIR_KEY_LENGTH = 8
CLOUDROP_PAIR_KEY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789_@$&"
CLOUDROP_PEER_STALE_SECONDS = int(os.getenv("CLOUDROP_PEER_STALE_SECONDS", "300"))
CLOUDROP_MAX_CHAT_LENGTH = int(os.getenv("CLOUDROP_MAX_CHAT_LENGTH", "65536"))
CLOUDROP_MAX_FILE_SIZE = 1024 * 1024 * 1024

CLOUDROP_TURN_URLS = env_list("CLOUDROP_TURN_URLS")
CLOUDROP_TURN_SECRET = os.getenv("CLOUDROP_TURN_SECRET", "")
CLOUDROP_TURN_CREDENTIAL_TTL = int(os.getenv("CLOUDROP_TURN_CREDENTIAL_TTL", "3600"))

if TESTING:
    CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
else:
    REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/1")
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [redis_host_config(REDIS_URL)],
                "prefix": os.getenv("CLOUDROP_REDIS_PREFIX", "cloudrop"),
                "capacity": 1000,
                "expiry": 60,
            },
        }
    }

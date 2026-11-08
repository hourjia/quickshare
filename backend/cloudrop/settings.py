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


def env_int(name: str, default: int, *, minimum: int = 1) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise ImproperlyConfigured(f"{name} 必须是整数，当前为 {raw!r}") from error
    if value < minimum:
        raise ImproperlyConfigured(f"{name} 不能小于 {minimum}，当前为 {value}")
    return value


def env_optional_seconds(name: str) -> float | None:
    """读取可选的超时秒数；空值或 none/off/disabled 表示不启用超时。"""
    raw = os.getenv(name, "").strip().lower()
    if raw in {"", "none", "off", "disabled"}:
        return None
    try:
        value = float(raw)
    except ValueError as error:
        raise ImproperlyConfigured(f"{name} 必须是秒数或 none，当前为 {raw!r}") from error
    if value <= 0:
        raise ImproperlyConfigured(f"{name} 必须大于 0，当前为 {value}")
    return value


def redis_host_config(address: str) -> dict[str, object]:
    # 超时默认关闭：channel layer 是长连接，客户端超时会导致消息被静默丢弃。
    return {
        "address": address,
        "socket_timeout": env_optional_seconds("CLOUDROP_REDIS_SOCKET_TIMEOUT"),
        "socket_connect_timeout": env_optional_seconds(
            "CLOUDROP_REDIS_SOCKET_CONNECT_TIMEOUT"
        ),
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

# Redis 在服务器上是独立进程，全部连接参数只能由环境变量提供，代码不保留本机地址兜底。
CLOUDROP_CHANNEL_LAYER = os.getenv("CLOUDROP_CHANNEL_LAYER", "redis").strip().lower()
if CLOUDROP_CHANNEL_LAYER not in {"redis", "memory"}:
    raise ImproperlyConfigured(
        f"CLOUDROP_CHANNEL_LAYER 只能是 redis 或 memory，当前为 {CLOUDROP_CHANNEL_LAYER!r}"
    )

if TESTING or CLOUDROP_CHANNEL_LAYER == "memory":
    # 测试与单进程部署：通道层留在进程内存里，不需要 Redis。
    CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
else:
    REDIS_URL = os.getenv("REDIS_URL", "").strip()
    if not REDIS_URL:
        raise ImproperlyConfigured(
            "REDIS_URL is required（Redis 作为独立进程提供跨进程实时通道）。"
            "请提供完整连接串，例如 redis://:密码@10.0.0.8:6379/5；"
            "单进程部署可设置 CLOUDROP_CHANNEL_LAYER=memory 跳过 Redis。"
        )
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [redis_host_config(REDIS_URL)],
                "prefix": os.getenv("CLOUDROP_REDIS_PREFIX", "cloudrop").strip() or "cloudrop",
                "capacity": env_int("CLOUDROP_REDIS_CAPACITY", 1000),
                "expiry": env_int("CLOUDROP_REDIS_EXPIRY", 60),
            },
        }
    }

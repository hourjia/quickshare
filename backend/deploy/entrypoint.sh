#!/bin/sh
set -eu

echo "Waiting for database connection..."
while true; do
  if python - <<'PY'
import os
import sys

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cloudrop.settings")

import django
from django.db import connections
from django.db.utils import OperationalError

django.setup()
connection = connections["default"]

try:
    connection.ensure_connection()
except OperationalError as exc:
    print(f"Database is unavailable: {exc}", file=sys.stderr)
    raise SystemExit(75)
else:
    connection.close()
PY
  then
    echo "Database connection established."
    break
  else
    status=$?
  fi

  if [ "$status" -ne 75 ]; then
    echo "Database readiness check failed with exit code $status." >&2
    exit "$status"
  fi

  sleep 2
done

python manage.py migrate --noinput
python manage.py cleanup_stale_peers --max-age-hours 24

exec uvicorn cloudrop.asgi:application \
  --host 0.0.0.0 \
  --port 8000 \
  --proxy-headers \
  --forwarded-allow-ips="*" \
  --workers "${UVICORN_WORKERS:-2}"

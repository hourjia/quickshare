FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY manage.py ./
COPY cloudrop ./cloudrop
COPY transfer ./transfer
COPY --chmod=755 deploy/entrypoint.sh /usr/local/bin/cloudrop-entrypoint

RUN addgroup --system cloudrop \
    && adduser --system --ingroup cloudrop cloudrop \
    && chown -R cloudrop:cloudrop /app

USER cloudrop
EXPOSE 8000
ENTRYPOINT ["cloudrop-entrypoint"]

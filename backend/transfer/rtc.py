from __future__ import annotations

import base64
import hashlib
import hmac
import time
import uuid

from django.conf import settings


def ice_servers_for(peer_id: uuid.UUID) -> list[dict[str, object]]:
    servers: list[dict[str, object]] = []
    turn_urls: list[str] = []
    for url in settings.CLOUDROP_TURN_URLS:
        if url.lower().startswith("stun:"):
            servers.append({"urls": [url]})
        elif url.lower().startswith(("turn:", "turns:")):
            turn_urls.append(url)

    if turn_urls and settings.CLOUDROP_TURN_SECRET:
        expires_at = int(time.time()) + settings.CLOUDROP_TURN_CREDENTIAL_TTL
        username = f"{expires_at}:{peer_id}"
        digest = hmac.new(
            settings.CLOUDROP_TURN_SECRET.encode("utf-8"),
            username.encode("utf-8"),
            hashlib.sha1,
        ).digest()
        servers.append(
            {
                "urls": turn_urls,
                "username": username,
                "credential": base64.b64encode(digest).decode("ascii"),
            }
        )
    return servers


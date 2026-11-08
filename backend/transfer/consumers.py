from __future__ import annotations

import uuid
from urllib.parse import urlparse

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings

from .pairing import (
    PairingError,
    close_peer,
    create_peer,
    get_partner_channel,
    leave_pair,
    pair_peer,
    touch_peer,
)
from .rtc import ice_servers_for
from .security import SECURITY_GROUP, websocket_authorization


class SessionConsumer(AsyncJsonWebsocketConsumer):
    peer_id: uuid.UUID | None = None

    async def connect(self) -> None:
        authorized, locked = await database_sync_to_async(websocket_authorization)(
            self.scope.get("session")
        )
        if not authorized:
            await self.close(code=4423 if locked else 4401)
            return

        await self.channel_layer.group_add(SECURITY_GROUP, self.channel_name)
        authorized, locked = await database_sync_to_async(websocket_authorization)(
            self.scope.get("session")
        )
        if not authorized:
            await self.channel_layer.group_discard(SECURITY_GROUP, self.channel_name)
            await self.close(code=4423 if locked else 4401)
            return

        created = await database_sync_to_async(create_peer)(self.channel_name)
        self.peer_id = created.id
        await self.accept()
        await self.send_json(
            {
                "type": "ready",
                "peerId": str(created.id),
                "key": created.key,
                "iceServers": ice_servers_for(created.id),
                "maxFileSize": settings.CLOUDROP_MAX_FILE_SIZE,
            }
        )

    async def disconnect(self, close_code: int) -> None:
        await self.channel_layer.group_discard(SECURITY_GROUP, self.channel_name)
        if self.peer_id is None:
            return
        update = await database_sync_to_async(close_peer)(self.peer_id)
        if update:
            await self.channel_layer.send(
                update.channel_name,
                {
                    "type": "peer.event",
                    "payload": {
                        "type": "peer_disconnected",
                        "key": update.key,
                    },
                },
            )

    async def receive_json(self, content: object, **kwargs: object) -> None:
        if self.peer_id is None or not isinstance(content, dict):
            return
        message_type = content.get("type")
        try:
            if message_type == "ping":
                await database_sync_to_async(touch_peer)(self.peer_id)
                await self.send_json({"type": "pong"})
            elif message_type == "pair":
                await self._pair(content)
            elif message_type == "chat":
                await self._chat(content)
            elif message_type == "signal":
                await self._signal(content)
            elif message_type == "leave":
                await self._leave()
            else:
                await self._error("unknown_message", "不支持的消息类型")
        except PairingError as error:
            await self._error(error.code, error.message)

    async def _pair(self, content: dict[str, object]) -> None:
        key = content.get("key")
        if not isinstance(key, str):
            raise PairingError("invalid_key", "请输入配对 Key")
        result = await database_sync_to_async(pair_peer)(self.peer_id, key)
        await self.channel_layer.send(
            result.requester_channel,
            {
                "type": "peer.event",
                "payload": {"type": "paired", "initiator": True},
            },
        )
        await self.channel_layer.send(
            result.target_channel,
            {
                "type": "peer.event",
                "payload": {"type": "paired", "initiator": False},
            },
        )

    async def _chat(self, content: dict[str, object]) -> None:
        kind = content.get("kind")
        value = content.get("content")
        message_id = content.get("id")
        if kind not in {"text", "link"} or not isinstance(value, str) or not value.strip():
            raise PairingError("invalid_chat", "消息内容不正确")
        if len(value) > settings.CLOUDROP_MAX_CHAT_LENGTH:
            raise PairingError("message_too_large", "文本内容过长")
        if kind == "link":
            parsed = urlparse(value)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise PairingError("invalid_link", "链接必须使用 HTTP 或 HTTPS")
        partner_channel = await database_sync_to_async(get_partner_channel)(self.peer_id)
        await self.channel_layer.send(
            partner_channel,
            {
                "type": "peer.event",
                "payload": {
                    "type": "chat",
                    "id": str(message_id or uuid.uuid4()),
                    "kind": kind,
                    "content": value,
                },
            },
        )

    async def _signal(self, content: dict[str, object]) -> None:
        signal_kind = content.get("kind")
        payload = content.get("payload")
        if signal_kind not in {"offer", "answer", "ice"} or not isinstance(payload, dict):
            raise PairingError("invalid_signal", "WebRTC 信令格式不正确")
        partner_channel = await database_sync_to_async(get_partner_channel)(self.peer_id)
        await self.channel_layer.send(
            partner_channel,
            {
                "type": "peer.event",
                "payload": {
                    "type": "signal",
                    "kind": signal_kind,
                    "payload": payload,
                },
            },
        )

    async def _leave(self) -> None:
        result = await database_sync_to_async(leave_pair)(self.peer_id)
        for update in (result.first, result.second):
            await self.channel_layer.send(
                update.channel_name,
                {
                    "type": "peer.event",
                    "payload": {
                        "type": "peer_disconnected",
                        "key": update.key,
                    },
                },
            )

    async def _error(self, code: str, message: str) -> None:
        await self.send_json({"type": "error", "code": code, "message": message})

    async def peer_event(self, event: dict[str, object]) -> None:
        await self.send_json(event["payload"])

    async def server_locked(self, event: dict[str, object]) -> None:
        await self.send_json({"type": "server_locked"})
        await self.close(code=4423)

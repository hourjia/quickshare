from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import PeerSession


class PairingError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class PeerCreated:
    id: uuid.UUID
    key: str


@dataclass(frozen=True)
class PairingResult:
    requester_channel: str
    target_channel: str


@dataclass(frozen=True)
class PartnerUpdate:
    channel_name: str
    key: str


@dataclass(frozen=True)
class LeaveResult:
    first: PartnerUpdate
    second: PartnerUpdate


def normalize_key(value: str) -> str:
    return value.strip().upper()


def _random_key() -> str:
    return "".join(
        secrets.choice(settings.CLOUDROP_PAIR_KEY_ALPHABET)
        for _ in range(settings.CLOUDROP_PAIR_KEY_LENGTH)
    )


def _available_key(excluded: set[str] | None = None) -> str:
    excluded = excluded or set()
    for _ in range(64):
        candidate = _random_key()
        if candidate not in excluded and not PeerSession.objects.filter(key=candidate).exists():
            return candidate
    raise RuntimeError("Unable to allocate a unique pairing key")


def expire_stale_peers() -> int:
    cutoff = timezone.now() - timedelta(seconds=settings.CLOUDROP_PEER_STALE_SECONDS)
    return PeerSession.objects.filter(
        state=PeerSession.State.WAITING,
        updated_at__lt=cutoff,
    ).update(state=PeerSession.State.CLOSED, key=None, partner_id=None)


def create_peer(channel_name: str) -> PeerCreated:
    expire_stale_peers()
    for _ in range(64):
        key = _random_key()
        try:
            peer = PeerSession.objects.create(channel_name=channel_name, key=key)
            return PeerCreated(peer.id, key)
        except IntegrityError:
            continue
    raise RuntimeError("Unable to allocate a unique pairing key")


def touch_peer(peer_id: uuid.UUID) -> None:
    PeerSession.objects.filter(id=peer_id, state__in=[PeerSession.State.WAITING, PeerSession.State.PAIRED]).update(
        updated_at=timezone.now()
    )


def pair_peer(requester_id: uuid.UUID, raw_key: str) -> PairingResult:
    key = normalize_key(raw_key)
    if len(key) != settings.CLOUDROP_PAIR_KEY_LENGTH or any(
        character not in settings.CLOUDROP_PAIR_KEY_ALPHABET for character in key
    ):
        raise PairingError("invalid_key", "配对 Key 格式不正确")

    cutoff = timezone.now() - timedelta(seconds=settings.CLOUDROP_PEER_STALE_SECONDS)
    target_hint = PeerSession.objects.filter(
        key=key,
        state=PeerSession.State.WAITING,
        updated_at__gte=cutoff,
    ).first()
    if target_hint is None:
        raise PairingError("key_unavailable", "该 Key 不存在、已配对或已失效")
    if target_hint.id == requester_id:
        raise PairingError("self_pair", "不能与当前页面自身配对")

    with transaction.atomic():
        ids = sorted([requester_id, target_hint.id], key=str)
        locked = {
            peer.id: peer
            for peer in PeerSession.objects.select_for_update().filter(id__in=ids).order_by("id")
        }
        requester = locked.get(requester_id)
        target = locked.get(target_hint.id)
        if requester is None or requester.state != PeerSession.State.WAITING or requester.partner_id:
            raise PairingError("already_paired", "当前页面已经配对，不能再连接其他 Key")
        if target is None or target.state != PeerSession.State.WAITING or target.partner_id or target.key != key:
            raise PairingError("key_unavailable", "该 Key 已被其他页面配对")
        if target.updated_at < cutoff:
            raise PairingError("key_unavailable", "该 Key 已失效")

        now = timezone.now()
        requester.state = PeerSession.State.PAIRED
        requester.partner_id = target.id
        requester.key = None
        requester.updated_at = now
        target.state = PeerSession.State.PAIRED
        target.partner_id = requester.id
        target.key = None
        target.updated_at = now
        PeerSession.objects.bulk_update(
            [requester, target],
            ["state", "partner_id", "key", "updated_at"],
        )
        return PairingResult(requester.channel_name, target.channel_name)


def get_partner_channel(peer_id: uuid.UUID) -> str:
    peer = PeerSession.objects.filter(id=peer_id, state=PeerSession.State.PAIRED).first()
    if peer is None or peer.partner_id is None:
        raise PairingError("not_paired", "当前页面尚未配对")
    partner = PeerSession.objects.filter(
        id=peer.partner_id,
        state=PeerSession.State.PAIRED,
        partner_id=peer.id,
    ).first()
    if partner is None:
        raise PairingError("not_paired", "对端已经断开")
    return partner.channel_name


def close_peer(peer_id: uuid.UUID) -> PartnerUpdate | None:
    peer_hint = PeerSession.objects.filter(id=peer_id).first()
    if peer_hint is None or peer_hint.state == PeerSession.State.CLOSED:
        return None

    ids = [peer_id]
    if peer_hint.partner_id:
        ids.append(peer_hint.partner_id)
    with transaction.atomic():
        locked = {
            peer.id: peer
            for peer in PeerSession.objects.select_for_update().filter(id__in=ids).order_by("id")
        }
        peer = locked.get(peer_id)
        if peer is None or peer.state == PeerSession.State.CLOSED:
            return None

        partner = locked.get(peer.partner_id) if peer.partner_id else None
        update: PartnerUpdate | None = None
        if partner and partner.state == PeerSession.State.PAIRED and partner.partner_id == peer.id:
            partner.state = PeerSession.State.WAITING
            partner.partner_id = None
            partner.key = _available_key()
            partner.updated_at = timezone.now()
            partner.save(update_fields=["state", "partner_id", "key", "updated_at"])
            update = PartnerUpdate(partner.channel_name, partner.key)

        peer.state = PeerSession.State.CLOSED
        peer.partner_id = None
        peer.key = None
        peer.save(update_fields=["state", "partner_id", "key", "updated_at"])
        return update


def leave_pair(peer_id: uuid.UUID) -> LeaveResult:
    peer_hint = PeerSession.objects.filter(id=peer_id).first()
    if peer_hint is None or peer_hint.partner_id is None:
        raise PairingError("not_paired", "当前页面尚未配对")

    ids = sorted([peer_id, peer_hint.partner_id], key=str)
    with transaction.atomic():
        locked = {
            peer.id: peer
            for peer in PeerSession.objects.select_for_update().filter(id__in=ids).order_by("id")
        }
        first = locked.get(peer_id)
        second = locked.get(peer_hint.partner_id)
        if (
            first is None
            or second is None
            or first.state != PeerSession.State.PAIRED
            or second.state != PeerSession.State.PAIRED
            or first.partner_id != second.id
            or second.partner_id != first.id
        ):
            raise PairingError("not_paired", "对端已经断开")

        first.state = PeerSession.State.WAITING
        first.partner_id = None
        first.key = _available_key()
        second.state = PeerSession.State.WAITING
        second.partner_id = None
        second.key = _available_key({first.key})
        now = timezone.now()
        first.updated_at = now
        second.updated_at = now
        PeerSession.objects.bulk_update(
            [first, second],
            ["state", "partner_id", "key", "updated_at"],
        )
        return LeaveResult(
            PartnerUpdate(first.channel_name, first.key),
            PartnerUpdate(second.channel_name, second.key),
        )

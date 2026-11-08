from __future__ import annotations

import uuid

from django.db import models


class SecurityState(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    password_fingerprint = models.CharField(max_length=64)
    failure_day = models.DateField()
    daily_failures = models.PositiveSmallIntegerField(default=0)
    locked = models.BooleanField(default=False)
    generation = models.PositiveBigIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)


class IpAttempt(models.Model):
    ip_address = models.GenericIPAddressField(unique=True)
    consecutive_failures = models.PositiveSmallIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)


class PeerSession(models.Model):
    class State(models.TextChoices):
        WAITING = "waiting", "Waiting"
        PAIRED = "paired", "Paired"
        CLOSED = "closed", "Closed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.CharField(max_length=8, unique=True, null=True, blank=True)
    channel_name = models.CharField(max_length=255)
    state = models.CharField(max_length=16, choices=State.choices, default=State.WAITING)
    partner_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["state", "updated_at"], name="transfer_pe_state_04e9fa_idx"),
        ]

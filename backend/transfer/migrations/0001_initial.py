import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="IpAttempt",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("ip_address", models.GenericIPAddressField(unique=True)),
                ("consecutive_failures", models.PositiveSmallIntegerField(default=0)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.CreateModel(
            name="SecurityState",
            fields=[
                ("id", models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False)),
                ("password_fingerprint", models.CharField(max_length=64)),
                ("failure_day", models.DateField()),
                ("daily_failures", models.PositiveSmallIntegerField(default=0)),
                ("locked", models.BooleanField(default=False)),
                ("generation", models.PositiveBigIntegerField(default=1)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.CreateModel(
            name="PeerSession",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("key", models.CharField(blank=True, max_length=8, null=True, unique=True)),
                ("channel_name", models.CharField(max_length=255)),
                ("state", models.CharField(choices=[("waiting", "Waiting"), ("paired", "Paired"), ("closed", "Closed")], default="waiting", max_length=16)),
                ("partner_id", models.UUIDField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "indexes": [models.Index(fields=["state", "updated_at"], name="transfer_pe_state_04e9fa_idx")],
            },
        ),
    ]


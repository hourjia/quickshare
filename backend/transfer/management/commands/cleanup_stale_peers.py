from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from transfer.models import PeerSession


class Command(BaseCommand):
    help = "Delete closed or stale peer-session rows"

    def add_arguments(self, parser) -> None:
        parser.add_argument("--max-age-hours", type=int, default=24)

    def handle(self, *args, **options) -> None:
        cutoff = timezone.now() - timedelta(hours=max(1, options["max_age_hours"]))
        deleted, _ = PeerSession.objects.filter(updated_at__lt=cutoff).delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} stale peer session rows"))


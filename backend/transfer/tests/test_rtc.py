import base64
import hashlib
import hmac
import uuid
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from transfer.rtc import ice_servers_for


class IceServerTests(SimpleTestCase):
    @override_settings(
        CLOUDROP_TURN_URLS=["stun:turn.example.com:3478", "turn:turn.example.com:3478?transport=udp"],
        CLOUDROP_TURN_SECRET="shared-secret",
        CLOUDROP_TURN_CREDENTIAL_TTL=3600,
    )
    @patch("transfer.rtc.time.time", return_value=1_000_000)
    def test_generates_time_limited_turn_credentials(self, _mock_time) -> None:
        peer_id = uuid.UUID("00000000-0000-0000-0000-000000000001")

        servers = ice_servers_for(peer_id)

        username = f"1003600:{peer_id}"
        expected = base64.b64encode(
            hmac.new(b"shared-secret", username.encode(), hashlib.sha1).digest()
        ).decode()
        self.assertEqual(servers[0], {"urls": ["stun:turn.example.com:3478"]})
        self.assertEqual(servers[1]["username"], username)
        self.assertEqual(servers[1]["credential"], expected)


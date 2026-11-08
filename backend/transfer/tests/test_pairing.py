from django.test import TestCase

from transfer.models import PeerSession
from transfer.pairing import PairingError, close_peer, create_peer, pair_peer


class PairingTests(TestCase):
    def test_pairing_is_exclusive_and_consumes_both_keys(self) -> None:
        requester = create_peer("channel.requester")
        target = create_peer("channel.target")
        latecomer = create_peer("channel.latecomer")

        result = pair_peer(requester.id, target.key)

        self.assertEqual(result.requester_channel, "channel.requester")
        self.assertEqual(result.target_channel, "channel.target")
        self.assertIsNone(PeerSession.objects.get(id=requester.id).key)
        self.assertIsNone(PeerSession.objects.get(id=target.id).key)
        with self.assertRaises(PairingError) as raised:
            pair_peer(latecomer.id, target.key)
        self.assertEqual(raised.exception.code, "key_unavailable")

    def test_surviving_peer_gets_new_key_after_disconnect(self) -> None:
        requester = create_peer("channel.requester")
        target = create_peer("channel.target")
        pair_peer(requester.id, target.key)

        update = close_peer(requester.id)

        self.assertIsNotNone(update)
        assert update is not None
        self.assertEqual(update.channel_name, "channel.target")
        self.assertNotEqual(update.key, target.key)
        survivor = PeerSession.objects.get(id=target.id)
        self.assertEqual(survivor.state, PeerSession.State.WAITING)
        self.assertEqual(survivor.key, update.key)

    def test_key_uses_confirmed_character_set(self) -> None:
        peer = create_peer("channel.key")

        self.assertEqual(len(peer.key), 8)
        self.assertTrue(set(peer.key) <= set("ABCDEFGHJKMNPQRSTUVWXYZ23456789_@$&"))
        self.assertNotIn("%", peer.key)
        self.assertNotIn("?", peer.key)


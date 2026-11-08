from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from django.conf import settings
from django.test import Client, TransactionTestCase, override_settings

from cloudrop.asgi import application


@override_settings(CLOUDROP_ACCESS_PASSWORD="correct-password")
class SessionConsumerTests(TransactionTestCase):
    reset_sequences = True

    def test_authorized_browser_session_receives_pairing_key(self) -> None:
        client = Client(HTTP_HOST="127.0.0.1")
        response = client.post(
            "/api/auth/login",
            data='{"password":"correct-password"}',
            content_type="application/json",
            REMOTE_ADDR="203.0.113.70",
        )
        self.assertEqual(response.status_code, 200)
        session_cookie = client.cookies[settings.SESSION_COOKIE_NAME].value

        async def exercise_socket() -> None:
            communicator = WebsocketCommunicator(
                application,
                "/ws/session/",
                headers=[
                    (b"host", b"127.0.0.1"),
                    (b"origin", b"http://127.0.0.1:5173"),
                    (
                        b"cookie",
                        f"{settings.SESSION_COOKIE_NAME}={session_cookie}".encode(),
                    ),
                ],
            )
            connected, _ = await communicator.connect(timeout=5)
            self.assertTrue(connected)
            ready = await communicator.receive_json_from(timeout=5)
            self.assertEqual(ready["type"], "ready")
            self.assertEqual(len(ready["key"]), 8)
            await communicator.disconnect()

        async_to_sync(exercise_socket)()


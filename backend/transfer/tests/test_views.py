from django.test import Client, TestCase, override_settings

from transfer.security import SESSION_GENERATION_KEY


@override_settings(CLOUDROP_ACCESS_PASSWORD="correct-password")
class AuthenticationViewTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()

    def test_login_creates_browser_session_authorization(self) -> None:
        response = self.client.post(
            "/api/auth/login",
            data='{"password":"correct-password"}',
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn(SESSION_GENERATION_KEY, self.client.session)
        status = self.client.get("/api/auth/status")
        self.assertTrue(status.json()["authorized"])

    def test_lock_returns_http_423(self) -> None:
        for _ in range(5):
            response = self.client.post(
                "/api/auth/login",
                data='{"password":"wrong"}',
                content_type="application/json",
                REMOTE_ADDR="203.0.113.50",
            )

        self.assertEqual(response.status_code, 423)
        self.assertTrue(response.json()["locked"])


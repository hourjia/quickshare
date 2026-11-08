from __future__ import annotations

import os
from unittest.mock import patch

from asgiref.sync import async_to_sync
from channels_redis.core import RedisChannelLayer
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from cloudrop.settings import env_int, env_optional_seconds, redis_host_config


class RedisChannelLayerSettingsTests(SimpleTestCase):
    def test_redis_connections_disable_client_socket_timeouts(self) -> None:
        with patch.dict(
            os.environ,
            {
                "CLOUDROP_REDIS_SOCKET_TIMEOUT": "",
                "CLOUDROP_REDIS_SOCKET_CONNECT_TIMEOUT": "",
            },
        ):
            async def inspect_connection() -> tuple[float | None, float | None]:
                layer = RedisChannelLayer(
                    hosts=[redis_host_config("redis://127.0.0.1:6379/1")]
                )
                client = layer.connection(0)
                pool = client.connection_pool
                connection = pool.connection_class(**pool.connection_kwargs)
                try:
                    return connection.socket_timeout, connection.socket_connect_timeout
                finally:
                    await client.aclose()

            socket_timeout, socket_connect_timeout = async_to_sync(inspect_connection)()

        self.assertIsNone(socket_timeout)
        self.assertIsNone(socket_connect_timeout)

    def test_socket_timeouts_can_be_set_from_environment(self) -> None:
        with patch.dict(
            os.environ,
            {
                "CLOUDROP_REDIS_SOCKET_TIMEOUT": "5",
                "CLOUDROP_REDIS_SOCKET_CONNECT_TIMEOUT": "2.5",
            },
        ):
            config = redis_host_config("redis://redis.internal:6379/5")

        self.assertEqual(config["address"], "redis://redis.internal:6379/5")
        self.assertEqual(config["socket_timeout"], 5.0)
        self.assertEqual(config["socket_connect_timeout"], 2.5)

    def test_timeout_disabled_with_none_keyword(self) -> None:
        with patch.dict(os.environ, {"CLOUDROP_REDIS_SOCKET_TIMEOUT": "none"}):
            self.assertIsNone(
                redis_host_config("redis://redis.internal:6379/5")["socket_timeout"]
            )


class RedisEnvHelpersTests(SimpleTestCase):
    def test_env_int_falls_back_to_default(self) -> None:
        with patch.dict(os.environ, {"CLOUDROP_TEST_LIMIT": ""}):
            self.assertEqual(env_int("CLOUDROP_TEST_LIMIT", 1000), 1000)

    def test_env_int_reads_integer(self) -> None:
        with patch.dict(os.environ, {"CLOUDROP_TEST_LIMIT": "2048"}):
            self.assertEqual(env_int("CLOUDROP_TEST_LIMIT", 1000), 2048)

    def test_env_int_rejects_non_integer(self) -> None:
        with patch.dict(os.environ, {"CLOUDROP_TEST_LIMIT": "many"}):
            with self.assertRaises(ImproperlyConfigured):
                env_int("CLOUDROP_TEST_LIMIT", 1000)

    def test_env_int_rejects_value_below_minimum(self) -> None:
        with patch.dict(os.environ, {"CLOUDROP_TEST_LIMIT": "0"}):
            with self.assertRaises(ImproperlyConfigured):
                env_int("CLOUDROP_TEST_LIMIT", 1000)

    def test_env_optional_seconds_accepts_float(self) -> None:
        with patch.dict(os.environ, {"CLOUDROP_TEST_TIMEOUT": "0.75"}):
            self.assertEqual(env_optional_seconds("CLOUDROP_TEST_TIMEOUT"), 0.75)

    def test_env_optional_seconds_rejects_negative(self) -> None:
        with patch.dict(os.environ, {"CLOUDROP_TEST_TIMEOUT": "-1"}):
            with self.assertRaises(ImproperlyConfigured):
                env_optional_seconds("CLOUDROP_TEST_TIMEOUT")

    def test_env_optional_seconds_rejects_garbage(self) -> None:
        with patch.dict(os.environ, {"CLOUDROP_TEST_TIMEOUT": "soon"}):
            with self.assertRaises(ImproperlyConfigured):
                env_optional_seconds("CLOUDROP_TEST_TIMEOUT")

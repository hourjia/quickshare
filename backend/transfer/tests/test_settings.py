from asgiref.sync import async_to_sync
from channels_redis.core import RedisChannelLayer
from django.test import SimpleTestCase

from cloudrop.settings import redis_host_config


class RedisChannelLayerSettingsTests(SimpleTestCase):
    def test_redis_connections_disable_client_socket_timeouts(self) -> None:
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

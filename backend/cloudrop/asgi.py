import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cloudrop.settings")

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from channels.sessions import SessionMiddlewareStack
from django.core.asgi import get_asgi_application

django_asgi_application = get_asgi_application()

from transfer.routing import websocket_urlpatterns

application = ProtocolTypeRouter(
    {
        "http": django_asgi_application,
        "websocket": AllowedHostsOriginValidator(
            SessionMiddlewareStack(URLRouter(websocket_urlpatterns))
        ),
    }
)

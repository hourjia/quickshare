from django.urls import path

from .consumers import SessionConsumer


websocket_urlpatterns = [
    path("ws/session/", SessionConsumer.as_asgi()),
]


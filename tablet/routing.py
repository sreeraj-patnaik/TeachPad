"""
WebSocket URL routing. All drawing clients connect to the same room.
"""
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/draw/$', consumers.DrawConsumer.as_asgi()),
]

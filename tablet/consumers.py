"""
WebSocket consumer: single draw room. Relays all messages to the group.
No persistence; no database. Phone and display both join same group.
"""
import json
from channels.generic.websocket import AsyncWebsocketConsumer


# Single shared room name for all clients (phone + display)
GROUP_NAME = 'draw_room'


class DrawConsumer(AsyncWebsocketConsumer):
    """Join draw_room, receive messages, broadcast to group."""

    async def connect(self):
        await self.channel_layer.group_add(GROUP_NAME, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(GROUP_NAME, self.channel_name)

    async def receive(self, text_data):
        """
        Relay incoming message to entire group immediately.
        No parsing or storage; pass-through for low latency.
        """
        await self.channel_layer.group_send(
            GROUP_NAME,
            {
                'type': 'draw_message',
                'message': text_data,
            },
        )

    async def draw_message(self, event):
        """Send to this WebSocket client (called for each group member)."""
        await self.send(text_data=event['message'])

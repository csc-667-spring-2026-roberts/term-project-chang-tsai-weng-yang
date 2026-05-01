import type { Response } from "express";

export interface SseMessage {
  event: string;
  data: unknown;
}

interface Subscriber {
  id: string;
  response: Response;
}

const subscribersByRoom = new Map<string, Map<string, Subscriber>>();

function getOrCreateRoom(room: string): Map<string, Subscriber> {
  const normalizedRoom = room.trim();
  const existing = subscribersByRoom.get(normalizedRoom);
  if (existing) {
    return existing;
  }

  const created = new Map<string, Subscriber>();
  subscribersByRoom.set(normalizedRoom, created);
  return created;
}

export function addSubscriber(rooms: string[], subscriber: Subscriber): void {
  for (const room of rooms) {
    const bucket = getOrCreateRoom(room);
    bucket.set(subscriber.id, subscriber);
  }
}

export function removeSubscriber(rooms: string[], subscriberId: string): void {
  for (const room of rooms) {
    const bucket = subscribersByRoom.get(room);
    if (!bucket) {
      continue;
    }

    bucket.delete(subscriberId);
    if (bucket.size === 0) {
      subscribersByRoom.delete(room);
    }
  }
}

function formatSseMessage(message: SseMessage): string {
  const payload = JSON.stringify(message.data);
  return `event: ${message.event}\ndata: ${payload}\n\n`;
}

export function broadcastToRoom(room: string, message: SseMessage): number {
  const bucket = subscribersByRoom.get(room);
  if (!bucket || bucket.size === 0) {
    return 0;
  }

  const chunk = formatSseMessage(message);
  let delivered = 0;

  for (const { response } of bucket.values()) {
    response.write(chunk);
    delivered += 1;
  }

  return delivered;
}

export function broadcastToRooms(rooms: string[], message: SseMessage): number {
  const uniqueSubscriberIds = new Set<string>();
  const chunk = formatSseMessage(message);

  for (const room of rooms) {
    const bucket = subscribersByRoom.get(room);
    if (!bucket) {
      continue;
    }

    for (const { id, response } of bucket.values()) {
      if (uniqueSubscriberIds.has(id)) {
        continue;
      }

      response.write(chunk);
      uniqueSubscriberIds.add(id);
    }
  }

  return uniqueSubscriberIds.size;
}

export function parseSubscriptionRooms(raw: string | undefined): string[] {
  if (!raw) {
    return ["global"];
  }

  const parsed = raw
    .split(",")
    .map((room) => room.trim())
    .filter((room) => room.length > 0);

  return parsed.length > 0 ? Array.from(new Set(parsed)) : ["global"];
}

export function getRoomSubscriberCount(room: string): number {
  return subscribersByRoom.get(room)?.size ?? 0;
}

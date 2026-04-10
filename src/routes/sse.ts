import { randomUUID } from "crypto";
import express, { Request, Response } from "express";
import {
  addSubscriber,
  broadcastToRooms,
  parseSubscriptionRooms,
  removeSubscriber,
} from "../sse/hub.js";

const router = express.Router();
const RETRY_MS = 3000;
const HEARTBEAT_MS = 25_000;

function sessionRoom(req: Request): string | null {
  return req.sessionID ? `session:${req.sessionID}` : null;
}

function buildRooms(req: Request): string[] {
  const queryChannels =
    typeof req.query.channels === "string"
      ? req.query.channels
      : typeof req.query.room === "string"
        ? req.query.room
        : undefined;
  const rooms = parseSubscriptionRooms(queryChannels);
  const ownSessionRoom = sessionRoom(req);

  if (!ownSessionRoom) {
    return rooms;
  }

  return Array.from(new Set([...rooms, ownSessionRoom]));
}

function handleSse(req: Request, res: Response): void {
  const subscriberId = randomUUID();
  const rooms = buildRooms(req);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Suggest reconnection interval for client EventSource.
  res.write(`retry: ${String(RETRY_MS)}\n`);
  res.write(
    `event: connected\ndata: ${JSON.stringify({
      subscriberId,
      rooms,
      timestamp: Date.now(),
    })}\n\n`,
  );

  addSubscriber(rooms, { id: subscriberId, response: res });

  const heartbeatTimer = setInterval(() => {
    res.write(`event: ping\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
  }, HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(heartbeatTimer);
    removeSubscriber(rooms, subscriberId);
  });
}

router.get("/sse", handleSse);
router.get("/events", handleSse);

router.post("/events/broadcast", (req: Request, res: Response) => {
  const { rooms, event, data } = req.body as {
    rooms?: string[];
    event?: string;
    data?: unknown;
  };

  if (!event || !Array.isArray(rooms) || rooms.length === 0) {
    return res.status(400).json({ message: "rooms and event are required" });
  }

  const delivered = broadcastToRooms(rooms, {
    event,
    data: data ?? {},
  });

  return res.status(200).json({ delivered });
});

export { sessionRoom };
export default router;

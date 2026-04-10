import { once } from "events";
import { createServer, Server } from "http";
import assert from "node:assert/strict";
import test from "node:test";
import { app } from "../src/server.js";

interface OpenStreamResult {
  response: Response;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  close: () => Promise<void>;
}

const decoder = new TextDecoder();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function openSseStream(url: string): Promise<OpenStreamResult> {
  const controller = new AbortController();
  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      Accept: "text/event-stream",
    },
  });

  assert.equal(response.ok, true);
  assert.ok(response.body);

  const reader = response.body.getReader();

  return {
    response,
    reader,
    close: async () => {
      controller.abort();
      try {
        await reader.cancel();
      } catch {
        // Reader is already cancelled once request is aborted.
      }
    },
  };
}

async function readUntilContains(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expected: string,
  timeoutMs = 3000,
): Promise<string> {
  const start = Date.now();
  let output = "";

  while (Date.now() - start < timeoutMs) {
    const result = await reader.read();
    if (result.done) {
      throw new Error(`SSE stream closed before receiving "${expected}"`);
    }

    output += decoder.decode(result.value);
    if (output.includes(expected)) {
      return output;
    }
  }

  throw new Error(`Timed out waiting for "${expected}"`);
}

let server: Server;
let baseUrl = "";

test.before(async () => {
  server = createServer(app);
  server.listen(0);
  await once(server, "listening");
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to acquire server address");
  }

  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

test("SSE endpoint returns text/event-stream content type", async () => {
  const stream = await openSseStream(`${baseUrl}/api/sse`);
  assert.match(stream.response.headers.get("content-type") ?? "", /^text\/event-stream/);
  await stream.close();
});

test("SSE connection stays open", async () => {
  const stream = await openSseStream(`${baseUrl}/api/events`);
  await readUntilContains(stream.reader, "event: connected");

  const nextRead = stream.reader.read();
  const pendingResult = await Promise.race([
    nextRead.then(() => "read-resolved"),
    delay(250).then(() => "timeout"),
  ]);

  assert.equal(pendingResult, "timeout");
  await stream.close();
});

test("events are broadcast to multiple subscribers in same room", async () => {
  const first = await openSseStream(`${baseUrl}/api/sse?channels=room-alpha`);
  const second = await openSseStream(`${baseUrl}/api/sse?channels=room-alpha`);

  await readUntilContains(first.reader, "event: connected");
  await readUntilContains(second.reader, "event: connected");

  const broadcastResponse = await fetch(`${baseUrl}/api/events/broadcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rooms: ["room-alpha"],
      event: "game:update",
      data: { turn: 2 },
    }),
  });

  assert.equal(broadcastResponse.status, 200);
  const payload = (await broadcastResponse.json()) as { delivered: number };
  assert.equal(payload.delivered, 2);

  const firstEvent = await readUntilContains(first.reader, "event: game:update");
  const secondEvent = await readUntilContains(second.reader, "event: game:update");

  assert.match(firstEvent, /"turn":2/);
  assert.match(secondEvent, /"turn":2/);

  await first.close();
  await second.close();
});

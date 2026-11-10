import assert from "node:assert/strict";
import { test } from "node:test";
import { knock, MAX_NOTE, openDoor, type Note } from "./service.ts";

const note: Note = { agent: "make.1", text: "Use the short name.", mode: "steer" };
const post = async (port: number, headers: Record<string, string>, body: string): Promise<[number, unknown]> => {
  const r = await fetch(`http://127.0.0.1:${port}/note`, { method: "POST", headers, body });
  return [r.status, await r.json()];
};

test("a note handed through the door reaches the owner, and what the owner says comes back", async () => {
  const got: Note[] = [];
  const door = await openDoor({ note: async (n) => { got.push(n); return { ok: true, said: `sent to ${n.agent}` }; } });
  try {
    assert.deepEqual(await knock(door.at, note), { ok: true, said: "sent to make.1" });
    assert.deepEqual(await knock(door.at, { ...note, text: "  And add a test.  ", mode: "queue" }), { ok: true, said: "sent to make.1" });
    assert.deepEqual(got, [note, { agent: "make.1", text: "And add a test.", mode: "queue" }]);
  } finally { await door.close(); }
});

test("the door opens only to this run's token, never to a web page, and only for a note that is one", async () => {
  const got: Note[] = [];
  const door = await openDoor({ note: async (n) => { got.push(n); return { ok: true, said: "sent" }; } });
  const key = { "content-type": "application/json", "x-loop-door": door.at.token }, body = JSON.stringify(note);
  try {
    assert.deepEqual(await knock({ port: door.at.port, token: "0".repeat(48) }, note), { ok: false, said: "the token is not this run's" });
    assert.deepEqual(await post(door.at.port, { "content-type": "text/plain" }, body), [403, { ok: false, said: "the token is not this run's" }]);
    assert.deepEqual(await post(door.at.port, { ...key, origin: "https://elsewhere.example" }, body), [403, { ok: false, said: "a web page cannot knock on a run's door" }]);
    assert.deepEqual(await post(door.at.port, key, "not json"), [400, { ok: false, said: "the body is not JSON" }]);
    assert.deepEqual(await post(door.at.port, key, JSON.stringify({ ...note, agent: "" })), [400, { ok: false, said: "the note names no agent" }]);
    assert.deepEqual(await post(door.at.port, key, JSON.stringify({ ...note, text: "  " })), [400, { ok: false, said: "the note says nothing" }]);
    assert.deepEqual(await post(door.at.port, key, JSON.stringify({ ...note, text: "x".repeat(MAX_NOTE + 1) })), [400, { ok: false, said: `a note is at most ${MAX_NOTE} characters` }]);
    assert.deepEqual(await post(door.at.port, key, JSON.stringify({ ...note, mode: "shout" })), [400, { ok: false, said: "mode is steer or queue" }]);
    assert.equal((await fetch(`http://127.0.0.1:${door.at.port}/note`)).status, 404);
    assert.deepEqual(got, [], "nothing that was refused reached the owner");
  } finally { await door.close(); }
});

test("an owner that throws is said, and a door that is shut means the run is not being played", async () => {
  const door = await openDoor({ note: async () => { throw new Error("the storage is closed"); } });
  assert.deepEqual(await knock(door.at, note), { ok: false, said: "the note was not sent: the storage is closed" });
  await door.close();
  assert.deepEqual(await knock(door.at, note), { ok: false, said: "the run's process did not answer: it is not being played now" });
});

"""A stand-in for Meta's Muse Voice Transcribe, so you can develop without an API key.

    cd backend
    uv run python -m scripts.fake_muse_server          # listens on ws://localhost:9000

then in the repo-root .env:
    MODEL_API_KEY=fake
    MUSE_URL=ws://localhost:9000

It speaks the same protocol as the real thing (handshake -> audio in -> transcript events out),
but ignores the audio's content: after ~1.5 s of audio it "hears" the next canned sentence.
"""

import json

from websockets.sync.server import serve

SENTENCES = ["Are you hungry?", "Does it hurt anywhere?", "How are you feeling today?"]
BYTES_PER_SECOND = 16_000 * 2  # 16 kHz, 16-bit mono
LISTEN_SECONDS = 1.5


def handler(ws) -> None:
    handshake = json.loads(ws.recv())
    print("handshake:", {k: v for k, v in handshake.items() if k != "authorization"})
    ws.send(json.dumps({"sessionId": "fake-session"}))

    heard, turn = 0, 0
    for message in ws:
        if isinstance(message, bytes):
            heard += len(message)
            if heard >= BYTES_PER_SECOND * LISTEN_SECONDS:
                sentence = SENTENCES[turn % len(SENTENCES)]
                turn += 1
                heard = 0
                words = sentence.split()
                for i in range(1, len(words) + 1):  # partials are cumulative
                    ws.send(
                        json.dumps(
                            {
                                "type": "transcript",
                                "transcript": " ".join(words[:i]),
                                "final": False,
                            }
                        )
                    )
                ws.send(json.dumps({"type": "transcript", "transcript": sentence, "final": True}))
        elif json.loads(message).get("type") == "endStream":
            break


if __name__ == "__main__":
    with serve(handler, "localhost", 9000) as server:
        print("fake Muse server on ws://localhost:9000")
        server.serve_forever()

"""Keccak-256, as Ethereum uses it (the original Keccak padding, not FIPS SHA3-256), in plain Python.

Python's hashlib has SHA3-256 only, which pads differently and gives other hashes, and the bench has no Ethereum
library. A document's hash is keccak-256 (packages/blueprint, doc.create's `hash`), because the chain's PaymentSent
carries it and the Payments contract hashes with keccak too.
"""

_RC = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000, 0x000000000000808B,
    0x0000000080000001, 0x8000000080008081, 0x8000000000008009, 0x000000000000008A, 0x0000000000000088,
    0x0000000080008009, 0x000000008000000A, 0x000000008000808B, 0x800000000000008B, 0x8000000000008089,
    0x8000000000008003, 0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]
# The rotation of lane (x, y), indexed [x][y].
_ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]]
_MASK = (1 << 64) - 1
_RATE = 136  # bytes: 1600 bits less twice the 256-bit output


def _rotl(v, n):
    return ((v << n) | (v >> (64 - n))) & _MASK if n else v


def _permute(a):
    """Keccak-f[1600] on 25 lanes, a[x + 5 * y]."""
    for rc in _RC:
        c = [a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rotl(c[(x + 1) % 5], 1) for x in range(5)]
        a = [a[i] ^ d[i % 5] for i in range(25)]
        b = [0] * 25
        for x in range(5):
            for y in range(5):
                b[y + 5 * ((2 * x + 3 * y) % 5)] = _rotl(a[x + 5 * y], _ROT[x][y])
        a = [b[i] ^ ((~b[(i % 5 + 1) % 5 + 5 * (i // 5)]) & b[(i % 5 + 2) % 5 + 5 * (i // 5)]) for i in range(25)]
        a[0] ^= rc
    return a


def keccak256(data: bytes) -> bytes:
    padded = bytearray(data) + b"\x01"
    padded += b"\x00" * (-len(padded) % _RATE)
    padded[-1] |= 0x80
    state = [0] * 25
    for start in range(0, len(padded), _RATE):
        block = padded[start:start + _RATE]
        for i in range(_RATE // 8):
            state[i] ^= int.from_bytes(block[8 * i:8 * i + 8], "little")
        state = _permute(state)
    return b"".join(lane.to_bytes(8, "little") for lane in state[:4])


def hex_hash(data: bytes) -> str:
    return "0x" + keccak256(data).hex()

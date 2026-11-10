import hashlib
import hmac

import frappe
from frappe.utils.password import get_decrypted_password


def secret():
    return get_decrypted_password("Capxul Settings", "Capxul Settings", "secret", raise_exception=False) or ""


def sign(raw: bytes) -> str:
    return hmac.new(secret().encode(), raw, hashlib.sha256).hexdigest()


def valid(raw: bytes, header: str | None) -> bool:
    sec = secret()
    if not sec or not header:
        return False
    return hmac.compare_digest(sign(raw), header.strip().lower())

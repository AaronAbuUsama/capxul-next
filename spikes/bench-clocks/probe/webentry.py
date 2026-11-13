"""The smallest fix for the web process, tried here and not put in the app: load capxul before the first request.

gunicorn normally serves `frappe.app:application`, which imports no app; capxul (and so its clock wrapper) is loaded by
the first hook Frappe calls, which is after the request's session has been resumed. Serving `webentry:application`
instead installs the wrapper when the web process starts (compose.yaml, WEB_APP)."""
import capxul  # noqa: F401  (importing the app installs the clock wrapper: capxul/__init__.py)
from frappe.app import application  # noqa: F401

"""The world clock in every Python process of the bench, from before Frappe can read the time.

The clock wrapper (capxul/clock.py) is installed when the capxul package is imported. The bench CLI imports every app,
so `bench execute`, `bench worker` and `bench schedule` have it from their first reading; but gunicorn serves
`frappe.app:application`, which imports no app (the first hook loads capxul, after the request's session was resumed
with the host's time), and a plain Python process that calls frappe.init and frappe.connect never loads it at all.

So the bench's Python loads this at start: `write_pth()` puts a one-line `capxul_world_clock.pth` beside the
installed apps (run once when the image is built: `env/bin/python -c "import capxul.boot as b; b.write_pth()"`), and
Python runs that line in every process of the bench's environment. It imports capxul, which calls `arm()`: if Frappe
is already loaded the wrapper is installed at once; otherwise the wrapper is installed the moment `import frappe`
finishes, before any code can call now_datetime(). Arming imports nothing heavy, so processes that never touch Frappe
(pip, uv) pay nothing. If the wrapper cannot be installed, `import frappe` fails: host time is never read silently.
"""
import importlib.util
import os
import sys
import sysconfig

PTH = "capxul_world_clock.pth"  # sorts after the editable install's capxul.pth, which puts the app on sys.path
LINE = "import capxul\n"


def install_clock():
    from capxul import clock

    clock.install()


class AfterFrappe:
    """A one-shot import hook: when `frappe` is imported, run its module as usual, then install the clock."""

    def find_spec(self, name, path=None, target=None):
        if name != "frappe":
            return None
        if self in sys.meta_path:
            sys.meta_path.remove(self)
        spec = importlib.util.find_spec(name)
        if spec is not None and spec.loader is not None and hasattr(spec.loader, "exec_module"):
            run = spec.loader.exec_module

            def exec_module(module):
                run(module)
                install_clock()

            spec.loader.exec_module = exec_module
        return spec


def arm():
    """Called by capxul/__init__.py: install the clock now if Frappe is loaded, or as soon as it is."""
    if "frappe" in sys.modules:
        install_clock()
    elif not any(isinstance(f, AfterFrappe) for f in sys.meta_path):
        sys.meta_path.insert(0, AfterFrappe())


def write_pth(site_packages=None):
    """Write capxul_world_clock.pth into this interpreter's site-packages (or the folder given); returns its path."""
    p = os.path.join(site_packages or sysconfig.get_paths()["purelib"], PTH)
    with open(p, "w") as f:
        f.write(LINE)
    return p

__version__ = "0.0.1"

# The world's clock: every process that loads this app (web, worker, scheduler, bench, and through the bench's
# capxul_world_clock.pth every other Python process of the bench) reads its site's world time. See capxul/boot.py and
# capxul/clock.py.
from capxul import boot as _boot

_boot.arm()

__version__ = "0.0.1"

# The world's clock: every process that loads this app (web, worker, scheduler, bench) reads the site's clock offset
# from site_config.json. See capxul/clock.py.
from capxul import clock as _clock

_clock.install()

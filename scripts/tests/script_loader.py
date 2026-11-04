"""Load command scripts by filename for offline operations tests."""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys


SCRIPTS_DIRECTORY = Path(__file__).resolve().parents[1]


def load_script(module_name, filename):
    # Commands also import sibling helpers when run directly from scripts/.
    scripts_path = str(SCRIPTS_DIRECTORY)
    if scripts_path not in sys.path:
        sys.path.insert(0, scripts_path)
    spec = spec_from_file_location(module_name, SCRIPTS_DIRECTORY / filename)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

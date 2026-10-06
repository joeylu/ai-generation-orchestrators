"""Source-distribution entry point for the independently versioned UI layer preview."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/"src"))

VERSION = '0.1.0a2'

if __name__ == '__main__':
    # Service consumers decode the JSON protocol as UTF-8, regardless of host locale.
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    if sys.argv[1:] == ['--version']:
        print(VERSION)
    else:
        if len(sys.argv)>1 and sys.argv[1] in ('prepare-received-diagnostic','deliver-received-diagnostic'):
            from ai_ui_layers.received_diagnostic_delivery import main
        elif len(sys.argv)>1 and sys.argv[1] in ('host-run','host-status','host-next','host-authorize','host-receive','host-fail','host-resume'):
            from ai_ui_layers.host_delivery import main
        else:
            from ai_ui_layers.delivery_dag import main
        main()

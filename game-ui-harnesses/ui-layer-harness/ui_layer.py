"""Source-distribution entry point for the independently versioned UI layer preview."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/"src"))

VERSION = '0.1.0a2'

if __name__ == '__main__':
    if sys.argv[1:] == ['--version']:
        print(VERSION)
    else:
        from ai_ui_layers.delivery_dag import main
        main()

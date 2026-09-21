"""Source-distribution entry point for the independently versioned UI layer preview."""
import sys

VERSION = '0.1.0a1'

if __name__ == '__main__':
    if sys.argv[1:] == ['--version']:
        print(VERSION)
    else:
        from delivery_dag import main
        main()

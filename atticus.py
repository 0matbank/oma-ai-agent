#!/usr/bin/env python3
"""
Backwards-compatibility shim for Atticus commands.
Redirects all execution to oma.py.
"""
import sys
import subprocess
import os

if __name__ == '__main__':
    oma_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'oma.py')
    cmd = [sys.executable, oma_path] + sys.argv[1:]
    sys.exit(subprocess.call(cmd))

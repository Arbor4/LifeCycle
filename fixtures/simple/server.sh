#!/bin/sh
# Fixture service: sh wrapper + python child, to exercise process-group kill.
echo "booting fixture..."
python3 -m http.server 18099 &
echo "READY"
wait
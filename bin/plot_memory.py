#!/usr/bin/env python
#
# This script plots HeapDiff results produced by
# https://github.com/lloyd/node-memwatch, read from stdin.
#
# To use, pipe JSON structures containing heap diffs into this script, for
# example:
#
#    cat logs/server.log | grep "HEAP DIFF" | python bin/plot_memory.py
#
# or, to do it live:
#
#    tail -f logs/server.log | grep "HEAP DIFF" | python bin/plot_memory.py
#
# Producing heap diffs is fairly resource intensive, so it's not recommended to
# store this data in production.  To log heap diffs with the unhangout server,
# set environment variable NODE_DEBUG_LEAKS to "1", e.g.:
#
#   NODE_ENV=production NODE_DEBUG_LEAKS=1 npm start
#

import sys
import json
import pylab
from collections import defaultdict

def read_data():
    while True:
        line = sys.stdin.readline()
        print line
        try:
            data = json.loads(line)
        except ValueError:
            pass
        yield data

def run():
    colors = [
        'b', 'g', 'r', 'c', 'm', 'y', 'k',
        'b--', 'g--', 'r--', 'c--', 'm--', 'y--', 'k--',
        'bo', 'go', 'ro', 'co', 'mo', 'yo', 'ko',
        'b+', 'g+', 'r+', 'c+', 'm+', 'y+', 'k+',
        'b*', 'g*', 'r*', 'c*', 'm*', 'y*', 'k*',
        'b|', 'g|', 'r|', 'c|', 'm|', 'y|', 'k|',
    ]
    plots = defaultdict(list)
    heap_size = []
    order = ['Heap change']
    manager = pylab.get_current_fig_manager()
    manager.resize(1400, 1350)
    pylab.ion()

    for entry in read_data():
        heap_size.append(entry["after"]["size_bytes"])

        pylab.subplot(2, 1, 1)
        pylab.plot(heap_size, 'r', label='Heap size')
        pylab.legend(["Heap size"], loc=2)

        pylab.subplot(2, 1, 2)
        plots["Heap change"].append(entry["change"]["size_bytes"])
        for thing in entry["change"]["details"]:
            if thing["what"] not in order:
                order.append(thing["what"])
            plots[thing["what"]].append(thing["size_bytes"])

        for what, color in zip(order, colors):
            pylab.plot(plots[what], color, label=what)
        pylab.legend(order, loc=3)
        pylab.draw()

if __name__ == "__main__":
    run()

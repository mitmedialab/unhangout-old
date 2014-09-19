#!/bin/bash

# Stop everything if we get control-c, even if we aren't done.
trap "exit 1" SIGINT SIGTERM

# Change to the project root -- one above the current directory.
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd $DIR/..

MOCHA="node_modules/mocha/bin/mocha"

# Run non-selenium tests.
SKIP_SELENIUM_TESTS=1 NODE_ENV=testing $MOCHA
# Set the exit code to the result of that command -- 0 for pass, non-zero for
# fail.
EXIT=$?

# Run selenium tests, one at a time.
for TEST in test/test.*.selenium.js ; do
    NODE_ENV=testing $MOCHA $TEST
    STATUS=$?
    if [ $STATUS -ne 0 ]; then
        EXIT=$STATUS
    fi
done

# Exit status is non-zero if any test has failed; zero if all's good.
echo "EXIT STATUS $EXIT"
exit $EXIT

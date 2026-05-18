#!/bin/bash
echo "========================================"
echo "  PolyBTC - Polymarket BTC 5min Mirror"
echo "  Starting local server..."
echo "========================================"
echo ""
echo "Open http://localhost:8080 in your browser"
echo "Press Ctrl+C to stop."
echo ""

# Try to open browser automatically
if command -v open &> /dev/null; then
    open http://localhost:8080 &
elif command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:8080 &
fi

# Start server
if command -v python3 &> /dev/null; then
    python3 -m http.server 8080
elif command -v python &> /dev/null; then
    python -m http.server 8080
elif command -v npx &> /dev/null; then
    npx serve -l 8080 .
else
    echo "ERROR: Need Python or Node.js installed."
    echo "Install: brew install python3"
fi

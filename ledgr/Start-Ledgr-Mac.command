#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node &> /dev/null; then
  echo "Node.js is not installed on this computer."
  echo "Please install it first from https://nodejs.org (choose the LTS version),"
  echo "then double-click this file again."
  read -p "Press Enter to close..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Setting things up for the first time - this only happens once..."
  npm install
fi

echo ""
echo "Starting Ledgr..."
echo "Once you see 'Ledgr server running', open this in your browser:"
echo "  http://localhost:3000"
echo ""
echo "Leave this window open while you use the app. Closing it stops the server."
echo ""

( sleep 2 && open "http://localhost:3000" 2>/dev/null || xdg-open "http://localhost:3000" 2>/dev/null ) &
npm start

read -p "Press Enter to close..."

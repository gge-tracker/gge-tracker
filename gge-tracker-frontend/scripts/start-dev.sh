#!/bin/sh
if [ ! -d "node_modules" ]; then
  npm install --ignore-scripts
fi
ng serve --host 0.0.0.0
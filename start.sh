#!/bin/sh
cd /app && mkdir -p data uploads && [ -f data/db.json ] || node seed.js; exec node server.js

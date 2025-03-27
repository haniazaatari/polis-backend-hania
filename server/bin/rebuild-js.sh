#!/bin/bash

# Step 1: Set up src-ts directory
rm -rf dist
rm -rf src-ts
mkdir src-ts

# Step 2: Copy files from ../../polis/server/
cp ../../polis/server/app.ts ./src-ts/
cp -r ../../polis/server/src ./src-ts/

# Step 3: Build the project
npm run build

# Step 4: Copy from dist
cp dist/src-ts/app.js .
cp -R dist/src-ts/src/* ./src/

# Step 5: Clean up
rm -rf src-ts
rm -rf dist

# Step 6: Reformat
npm run format && npm run check:fix

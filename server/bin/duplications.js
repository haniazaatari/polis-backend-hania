#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  outputFile: null,
  minDuplications: 2,
  verbose: false,
  help: false
};

// Process command line arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === '--output' || arg === '-o') {
    options.outputFile = args[++i];
  } else if (arg === '--min' || arg === '-m') {
    options.minDuplications = Number.parseInt(args[++i], 10) || 2;
  } else if (arg === '--verbose' || arg === '-v') {
    options.verbose = true;
  } else if (arg === '--help' || arg === '-h') {
    options.help = true;
  }
}

// Display help message
if (options.help) {
  process.exit(0);
}

// Function to extract function names and content from a file
function extractFunctions(filePath, content) {
  const functionDefinitions = [];

  // Match traditional function declarations: function name(...) {...}
  const traditionalFuncRegex = /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)\s*{([^}]*)}/g;
  let match = traditionalFuncRegex.exec(content);

  while (match !== null) {
    functionDefinitions.push({
      name: match[1],
      type: 'traditional',
      file: filePath,
      params: match[2].trim(),
      body: match[3].trim()
    });
    match = traditionalFuncRegex.exec(content);
  }

  // Match arrow functions and function expressions: const/let/var name = (...) => {...} or function(...) {...}
  const arrowFuncRegex =
    /(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:function\s*\(([^)]*)\)|(\([^)]*\))\s*=>)/g;
  match = arrowFuncRegex.exec(content);

  while (match !== null) {
    functionDefinitions.push({
      name: match[2],
      type: 'arrow/expression',
      file: filePath,
      params: match[3] || match[4],
      // We can't easily capture the body for these functions with a simple regex
      body: ''
    });
    match = arrowFuncRegex.exec(content);
  }

  // Match object method definitions: methodName(...) {...}
  const objectMethodRegex = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)\s*{([^}]*)}/g;
  match = objectMethodRegex.exec(content);

  while (match !== null) {
    // Filter out common keywords that might be caught incorrectly
    if (!['if', 'for', 'while', 'switch', 'catch'].includes(match[1])) {
      functionDefinitions.push({
        name: match[1],
        type: 'object method',
        file: filePath,
        params: match[2].trim(),
        body: match[3].trim()
      });
    }
    match = objectMethodRegex.exec(content);
  }

  return functionDefinitions;
}

// Function to calculate similarity between two strings (0-1)
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;

  // Simple Jaccard similarity for now
  const set1 = new Set(str1.split(/\s+/));
  const set2 = new Set(str2.split(/\s+/));

  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

async function main() {
  try {
    // Find all JavaScript files in the project
    const files = await glob(['app.js', 'src/**/*.js'], { cwd: rootDir });

    // Store all function definitions
    const allFunctions = [];

    // Process each file
    for (const file of files) {
      const filePath = path.join(rootDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const functions = extractFunctions(file, content);
        allFunctions.push(...functions);
      } catch (error) {
        console.error(`Error reading file ${filePath}: ${error.message}`);
      }
    }

    // Group functions by name
    const functionMap = new Map();

    for (const func of allFunctions) {
      // Skip invalid function names
      if (typeof func.name !== 'string' || func.name === '') {
        continue;
      }

      if (!functionMap.has(func.name)) {
        functionMap.set(func.name, []);
      }

      functionMap.get(func.name).push(func);
    }

    // Filter for duplicated functions (appearing in more than one file)
    const duplicatedFunctions = Array.from(functionMap.entries())
      .filter(([_, funcs]) => {
        // Get unique file paths
        const uniqueFiles = new Set(funcs.map((f) => f.file));
        return uniqueFiles.size >= options.minDuplications;
      })
      .sort((a, b) => {
        // Sort by number of unique files first, then by function name
        const aFiles = new Set(a[1].map((f) => f.file)).size;
        const bFiles = new Set(b[1].map((f) => f.file)).size;

        if (bFiles !== aFiles) {
          return bFiles - aFiles;
        }

        return a[0].localeCompare(b[0]);
      });

    // Prepare output
    let output = '\n=== Duplicated Functions Analysis ===\n\n';

    if (duplicatedFunctions.length === 0) {
      output += 'No duplicated functions found.\n';
    } else {
      output += `Found ${duplicatedFunctions.length} duplicated function names:\n\n`;

      for (const [name, funcs] of duplicatedFunctions) {
        const uniqueFiles = [...new Set(funcs.map((f) => f.file))];
        output += `Function "${name}" appears in ${uniqueFiles.length} files:\n`;

        for (const file of uniqueFiles) {
          output += `  - ${file}\n`;
        }

        // If verbose mode is enabled, show similarity analysis
        if (options.verbose && funcs.length > 1) {
          output += '\n  Similarity analysis:\n';

          // Compare each function with each other
          for (let i = 0; i < funcs.length; i++) {
            for (let j = i + 1; j < funcs.length; j++) {
              const func1 = funcs[i];
              const func2 = funcs[j];

              const paramSimilarity = calculateSimilarity(func1.params, func2.params);
              const bodySimilarity = calculateSimilarity(func1.body, func2.body);

              output += `  - ${func1.file} vs ${func2.file}:\n`;
              output += `    Parameters similarity: ${Math.round(paramSimilarity * 100)}%\n`;
              output += `    Body similarity: ${Math.round(bodySimilarity * 100)}%\n`;
            }
          }
        }

        output += '\n';
      }

      // Summary statistics
      output += '=== Summary ===\n';
      output += `Total functions found: ${allFunctions.length}\n`;
      output += `Unique function names: ${functionMap.size}\n`;
      output += `Duplicated function names: ${duplicatedFunctions.length}\n`;

      // Top 5 most duplicated functions
      if (duplicatedFunctions.length > 0) {
        output += '\nTop 5 most duplicated functions:\n';
        for (const [name, funcs] of duplicatedFunctions.slice(0, 5)) {
          const uniqueFiles = [...new Set(funcs.map((f) => f.file))];
          output += `  "${name}" - ${uniqueFiles.length} files\n`;
        }
      }
    }

    // Write to file if specified
    if (options.outputFile) {
      fs.writeFileSync(options.outputFile, output);
    }
  } catch (_error) {
    process.exit(1);
  }
}

main();

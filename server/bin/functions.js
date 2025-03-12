#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  targetFile: 'src/server.js', // Default to server.js
  outputFile: null,
  limit: 20, // Show top 20 functions by default
  help: false
};

// Process command line arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === '--file' || arg === '-f') {
    options.targetFile = args[++i];
  } else if (arg === '--output' || arg === '-o') {
    options.outputFile = args[++i];
  } else if (arg === '--limit' || arg === '-l') {
    options.limit = Number.parseInt(args[++i], 10) || 20;
  } else if (arg === '--help' || arg === '-h') {
    options.help = true;
  }
}

// Display help message
if (options.help) {
  process.stdout.write(`
Function Size Analyzer

Usage:
  node functions.js [options]

Options:
  --file, -f     Target file to analyze (default: src/server.js)
  --output, -o   Output file for results
  --limit, -l    Number of functions to display (default: 20)
  --help, -h     Show this help message

Examples:
  node functions.js
  node functions.js --file src/app.js
  node functions.js --limit 50 --output results.txt
  \n`);
  process.exit(0);
}

// Function to extract function information from a file
function extractFunctions(_filePath, content) {
  const functionInfo = [];
  const lines = content.split('\n');

  // Process each line
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i];

    // Match traditional function declarations: function name(...) {...}
    const traditionalMatches = line.match(/function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)/g);
    if (traditionalMatches) {
      for (const match of traditionalMatches) {
        const nameMatch = match.match(/function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
        const paramsMatch = match.match(/\(([^)]*)\)/);

        if (nameMatch?.[1] && !['if', 'for', 'while', 'switch', 'catch'].includes(nameMatch[1])) {
          functionInfo.push({
            name: nameMatch[1],
            type: 'traditional',
            lineNumber,
            params: paramsMatch?.[1]?.trim() || '',
            startLine: lineNumber,
            isArrow: false
          });
        }
      }
    }

    // Match arrow functions: const/let/var name = (...) => {...}
    // First, try to match one-line arrow functions
    const oneLineArrowMatches = line.match(
      /(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>\s*[^{;].*;/g
    );
    if (oneLineArrowMatches) {
      for (const match of oneLineArrowMatches) {
        const nameMatch = match.match(/(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
        const paramsMatch = match.match(/=\s*(\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/);

        if (nameMatch?.[2]) {
          functionInfo.push({
            name: nameMatch[2],
            type: 'arrow (one-line)',
            lineNumber,
            params: paramsMatch?.[1]?.replace(/[()]/g, '').trim() || '',
            startLine: lineNumber,
            endLine: lineNumber,
            lineCount: 1,
            complexity: 0,
            isArrow: true,
            isOneLiner: true
          });
        }
      }
    }

    // Then, match multi-line arrow functions
    const arrowMatches = line.match(
      /(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>\s*{/g
    );
    if (arrowMatches) {
      for (const match of arrowMatches) {
        const nameMatch = match.match(/(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
        const paramsMatch = match.match(/=\s*(\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/);

        if (nameMatch?.[2]) {
          functionInfo.push({
            name: nameMatch[2],
            type: 'arrow',
            lineNumber,
            params: paramsMatch?.[1]?.replace(/[()]/g, '').trim() || '',
            startLine: lineNumber,
            isArrow: true,
            isOneLiner: false
          });
        }
      }
    }

    // Match function expressions: const/let/var name = function(...) {...}
    const funcExprMatches = line.match(/(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*function\s*\(([^)]*)\)/g);
    if (funcExprMatches) {
      for (const match of funcExprMatches) {
        const nameMatch = match.match(/(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
        const paramsMatch = match.match(/function\s*\(([^)]*)\)/);

        if (nameMatch?.[2]) {
          functionInfo.push({
            name: nameMatch[2],
            type: 'function expression',
            lineNumber,
            params: paramsMatch?.[1]?.trim() || '',
            startLine: lineNumber,
            isArrow: false
          });
        }
      }
    }

    // Match object methods: name(...) {...}
    const methodMatches = line.match(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)\s*{/g);
    if (methodMatches) {
      for (const match of methodMatches) {
        const nameMatch = match.match(/([a-zA-Z_$][a-zA-Z0-9_$]*)/);
        const paramsMatch = match.match(/\(([^)]*)\)/);

        if (nameMatch?.[1] && !['if', 'for', 'while', 'switch', 'catch'].includes(nameMatch[1])) {
          functionInfo.push({
            name: nameMatch[1],
            type: 'object method',
            lineNumber,
            params: paramsMatch?.[1]?.trim() || '',
            startLine: lineNumber,
            isArrow: false
          });
        }
      }
    }
  }

  // Calculate function sizes for functions that don't already have sizes calculated
  for (const func of functionInfo) {
    // Skip functions that already have sizes calculated
    if (func.lineCount !== undefined) continue;

    // For regular functions, find the matching closing brace
    let braceCount = 0;
    let currentLine = func.startLine;
    let foundOpeningBrace = false;

    // Find the opening brace
    while (currentLine <= lines.length && !foundOpeningBrace) {
      const line = lines[currentLine - 1];
      if (line.includes('{')) {
        foundOpeningBrace = true;
        braceCount = 1;

        // Count any additional braces on this line
        for (let j = line.indexOf('{') + 1; j < line.length; j++) {
          if (line[j] === '{') braceCount++;
          if (line[j] === '}') braceCount--;
        }
      } else {
        currentLine++;
        if (currentLine > func.startLine + 5) {
          // Look ahead max 5 lines
          // If no opening brace found, assume it's a one-liner
          func.endLine = func.startLine;
          func.lineCount = 1;
          func.complexity = 0;
          foundOpeningBrace = true; // to exit the loop
          break;
        }
      }
    }

    if (braceCount === 0) {
      // Function ended on the same line it started
      func.endLine = currentLine;
      func.lineCount = currentLine - func.startLine + 1;
      func.complexity = 0;
      continue;
    }

    // Now find the matching closing brace
    while (currentLine < lines.length && braceCount > 0) {
      currentLine++;
      if (currentLine > lines.length) break;

      const line = lines[currentLine - 1];

      // Count braces
      for (let j = 0; j < line.length; j++) {
        if (line[j] === '{') braceCount++;
        if (line[j] === '}') braceCount--;

        // Found the matching closing brace
        if (braceCount === 0) break;
      }
    }

    func.endLine = currentLine;
    func.lineCount = func.endLine - func.startLine + 1;

    // Calculate complexity (simplified: count of if, for, while, switch, try, catch)
    let complexity = 0;
    for (let j = func.startLine; j <= func.endLine && j <= lines.length; j++) {
      if (j > lines.length) break;
      const line = lines[j - 1];
      if (/\b(if|for|while|switch|try|catch)\b/.test(line)) {
        complexity++;
      }
    }
    func.complexity = complexity;
  }

  return functionInfo;
}

function main() {
  try {
    const filePath = path.join(rootDir, options.targetFile);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      process.stderr.write(`Error: File not found: ${filePath}\n`);
      process.exit(1);
    }

    // Read file content
    const content = fs.readFileSync(filePath, 'utf8');

    // Extract function information
    const functions = extractFunctions(options.targetFile, content);

    // Sort functions by line count (largest first)
    functions.sort((a, b) => b.lineCount - a.lineCount);

    // Prepare output
    let output = `\n=== Function Size Analysis for ${options.targetFile} ===\n\n`;
    output += `Total functions found: ${functions.length}\n\n`;

    // Display top functions by size
    output += `Top ${Math.min(options.limit, functions.length)} functions by size:\n\n`;

    for (let i = 0; i < Math.min(options.limit, functions.length); i++) {
      const func = functions[i];
      output += `${i + 1}. ${func.name} (${func.type})\n`;
      output += `   Lines: ${func.lineCount} (${func.startLine}-${func.endLine})\n`;
      output += `   Complexity: ${func.complexity}\n`;
      output += `   Parameters: ${func.params}\n\n`;
    }

    // Display top functions by complexity
    const complexityFunctions = [...functions].sort((a, b) => b.complexity - a.complexity);

    output += `\nTop ${Math.min(options.limit, functions.length)} functions by complexity:\n\n`;

    for (let i = 0; i < Math.min(options.limit, complexityFunctions.length); i++) {
      const func = complexityFunctions[i];
      output += `${i + 1}. ${func.name} (${func.type})\n`;
      output += `   Complexity: ${func.complexity}\n`;
      output += `   Lines: ${func.lineCount} (${func.startLine}-${func.endLine})\n`;
      output += `   Parameters: ${func.params}\n\n`;
    }

    // Add summary statistics
    output += '=== Summary Statistics ===\n\n';

    // Calculate average function size
    const totalLines = functions.reduce((sum, func) => sum + func.lineCount, 0);
    const averageSize = functions.length > 0 ? (totalLines / functions.length).toFixed(2) : 0;

    // Calculate average complexity
    const totalComplexity = functions.reduce((sum, func) => sum + func.complexity, 0);
    const averageComplexity = functions.length > 0 ? (totalComplexity / functions.length).toFixed(2) : 0;

    output += `Average function size: ${averageSize} lines\n`;
    output += `Average function complexity: ${averageComplexity}\n`;

    if (functions.length > 0) {
      output += `Largest function: ${functions[0].name} (${functions[0].lineCount} lines)\n`;
      output += `Most complex function: ${complexityFunctions[0].name} (complexity: ${complexityFunctions[0].complexity})\n`;
    }

    // Write to file if specified, otherwise print to console
    if (options.outputFile) {
      fs.writeFileSync(options.outputFile, output);
      process.stdout.write(`Results written to ${options.outputFile}\n`);
    } else {
      process.stdout.write(output);
    }
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();

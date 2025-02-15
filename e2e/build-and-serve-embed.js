#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const handler = require('serve-handler')
const http = require('http')
const yargs = require('yargs/yargs')

// Directory to output generated files
const OUTPUT_DIR = path.join(__dirname, 'embed')

const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 [options]')
  .option('type', {
    alias: 't',
    describe: 'Type of embed (regular or integrated)',
    choices: ['regular', 'integrated'],
    default: 'regular'
  })
  .option('conversationId', {
    alias: 'c',
    describe: 'The conversation ID (for regular embeds)',
    type: 'string'
  })
  .option('siteId', {
    alias: 's',
    describe: 'The site ID (for integrated embeds)',
    type: 'string'
  })
  .option('pageId', {
    alias: 'p',
    describe: 'The page ID (for integrated embeds)',
    type: 'string',
    default: 'test_page_1'
  })
  .option('baseUrl', {
    alias: 'u',
    describe: 'The base URL for the Polis API (include protocol, e.g. https://example.com)',
    type: 'string',
    default: process.env.BASE_URL || 'http://localhost'
  })
  .option('port', {
    alias: 'P',
    describe: 'Port to serve the test page on',
    type: 'number',
    default: 5002
  })
  .option('uiLang', {
    alias: 'l',
    describe: 'The UI language',
    type: 'string',
    default: 'en'
  })
  .check((argv) => {
    if (argv.type === 'regular' && !argv.conversationId) {
      throw new Error('Conversation ID is required for regular embeds')
    }
    if (argv.type === 'integrated' && !argv.siteId) {
      throw new Error('Site ID is required for integrated embeds')
    }
    
    // Ensure baseUrl has protocol
    if (!argv.baseUrl.startsWith('http://') && !argv.baseUrl.startsWith('https://')) {
      argv.baseUrl = 'https://' + argv.baseUrl
    }
    
    return true
  })
  .help()
  .argv

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}

// Read appropriate template
const templatePath = path.join(
  __dirname,
  'embed',
  argv.type === 'regular' ? 'template.html' : 'integrated-template.html'
)

const template = fs.readFileSync(templatePath, 'utf8')

// Replace template variables
let output = template
if (argv.type === 'regular') {
  output = template
    .replace(/<%= conversation_id %>/g, argv.conversationId)
    .replace(/<%= base_url %>/g, argv.baseUrl)
    .replace(/<%= ui_lang %>/g, argv.uiLang)
    // Set all user capability flags to true by default
    .replace(/<%= ucsd %>/g, '1')
    .replace(/<%= ucsf %>/g, '1')
    .replace(/<%= ucsh %>/g, '1')
    .replace(/<%= ucst %>/g, '1')
    .replace(/<%= ucsv %>/g, '1')
    .replace(/<%= ucv %>/g, '1')
    .replace(/<%= ucw %>/g, '1')
} else {
  output = template
    .replace(/<%= site_id %>/g, argv.siteId)
    .replace(/<%= page_id %>/g, argv.pageId)
    .replace(/<%= base_url %>/g, argv.baseUrl)
}

// Write output file
const outputFile = path.join(OUTPUT_DIR, 'index.html')
fs.writeFileSync(outputFile, output)

// Start server
const server = http.createServer((request, response) => {
  return handler(request, response, {
    public: OUTPUT_DIR,
    headers: [
      {
        source: '**/*',
        headers: [{
          key: 'Cache-Control',
          value: 'no-cache'
        }]
      }
    ]
  })
})

server.listen(argv.port, () => {
  console.log(`
Test embed page generated and being served!

URL: http://localhost:${argv.port}
Type: ${argv.type} embed
${argv.type === 'regular' 
  ? `Conversation ID: ${argv.conversationId}`
  : `Site ID: ${argv.siteId}\nPage ID: ${argv.pageId}`}
Base URL: ${argv.baseUrl}

Press Ctrl+C to stop the server.
`)
}) 
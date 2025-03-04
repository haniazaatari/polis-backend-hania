# Report Experimental

This is an experimental library for generating reports from Polis conversations.

These reports are to be checked by a human editor for hallucinations, before being published to participants. A user interface will be provided to the editor to help with this process, and this system is designed to support this process.

This library is model agnostic, and evals will cover both open source and proprietary models.

## Structure

The structure of the library is as follows:

📁 server/src/routes/reportNarrative/
├── README.md # This documentation file
├── index.ts # Main handler for the narrative report route
├── 📁 prompts/ # Folder containing prompts
....├── system.xml # Main system prompt, specificying the role of the LLM agent
....└── 📁 subtasks/ # Folder containing subtask prompts
........├── groups.xml # Analysis of group demographics
........├── group_informed_consensus.xml # Consensus across groups
........├── topics.xml # Topic analysis
........├── uncertainty.xml # Handling uncertainty in reports
........└── 📁 common/ # Common subtask components
............└── jsonSchema.xml # Shared JSON schema definitions
............└── typesReference.xml # Reference implementations of typescript types
├── 📁 models/ # Model service and implementations
├── 📁 sections/ # Section handlers for different report components
├── 📁 utils/ # Utility functions for the narrative report
├── 📁 coverage/ # Comment coverage metrics
├── 📁 topics/ # Topic extraction and management
└── 📁 types/ # TypeScript type definitions

## Approach

This experimental library

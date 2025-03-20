# Airtable App Data Analyzer

A Next.js application for analyzing app data from Airtable and detecting potential duplicates in CSV imports.

## Features

- View all apps from your Airtable base
- Search and filter apps by name, developer, category, and more
- Import and analyze CSV files with app data
- Detect potential duplicates between CSV data and existing Airtable records
- Validate CSV data before analysis

## Getting Started

### Prerequisites

- Node.js 18.x or later
- An Airtable account with a base containing app data
- Airtable API key

### Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```
NEXT_PUBLIC_AIRTABLE_API_KEY=your_airtable_api_key
NEXT_PUBLIC_AIRTABLE_BASE_ID=your_airtable_base_id
NEXT_PUBLIC_AIRTABLE_TABLE_NAME=your_table_name
```

### Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
# or
yarn install
# or
pnpm install
```

3. Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## CSV Import Format

The application expects CSV files with the following columns:

- App Name (required)
- App ID
- Developer
- Category
- Company Website
- Company LinkedIn URL
- Sensor Tower ID
- Google Play ID
- Developer ID

You can download a sample CSV file from the application to see the expected format.

## Airtable Base Structure

Your Airtable base should have a table with the following fields:

- App Name (Single line text)
- App ID (Single line text)
- Developer (Single line text)
- Category (Single line text)
- Company Website (URL)
- Company LinkedIn URL (URL)
- Sensor Tower ID (Single line text)
- Google Play ID (Single line text)
- Developer ID (Single line text)

## Duplicate Detection

The application detects potential duplicates based on the following fields:

- Company Website
- Company LinkedIn URL
- Sensor Tower ID
- Google Play ID
- Developer ID

If any of these fields match between your CSV data and existing Airtable records, the application will flag them as potential duplicates.

## Read-Only Mode

This application operates in read-only mode and does not modify your Airtable base. It only analyzes data and detects potential duplicates.

## License

MIT
# import

# PubTator BioC.XML Loader

A TypeScript Node.js application that loads BioC.XML files (PubTator format) into a PostgreSQL database using Prisma ORM. Features progress bars and comprehensive logging for processing single files or entire directories.

## Features

- ✅ Load single BioC.XML files or process entire directories
- ✅ PostgreSQL database with Prisma ORM
- ✅ Real-time progress bars showing file and record processing
- ✅ Comprehensive logging with Winston
- ✅ Full TypeScript support with type safety
- ✅ Handles complex nested XML structures (documents, passages, annotations, infons)
- ✅ Batch processing with error handling

## Prerequisites

- Node.js (v18 or higher)
- PostgreSQL database
- npm or yarn

## Installation

1. Clone the repository and navigate to the project directory:

```bash
cd pubtator-loader
```

2. Install dependencies:

```bash
npm install
```

3. Set up your database connection:

```bash
cp .env.example .env
```

Edit `.env` and update the `DATABASE_URL` with your PostgreSQL credentials:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/pubtator?schema=public"
```

4. Generate Prisma client and run migrations:

```bash
npm run prisma:generate
npm run prisma:migrate
```

This will create the database schema with the following tables:
- `collections` - Top-level collection metadata
- `documents` - Individual documents (e.g., PMC articles)
- `passages` - Document passages (title, abstract, sections)
- `infons` - Key-value metadata pairs
- `annotations` - Entity annotations (genes, chemicals, diseases, etc.)

## Build

Compile the TypeScript code:

```bash
npm run build
```

## Usage

### Process a Single File

```bash
npm start data/10.BioC.XML
```

Or after building:

```bash
node dist/index.js data/10.BioC.XML
```

### Process All XML Files in a Directory

```bash
npm start data/
```

Or:

```bash
node dist/index.js data/
```

## Progress Display

The application shows three levels of progress bars:

1. **Files Progress**: Shows progress across all files being processed
2. **Documents Progress**: Shows progress for documents within the current file
3. **Passages Progress**: Shows progress for passages within the current document

Example output:

```
2026-01-25 10:30:15 [INFO]: Found 1 file(s) to process
Files [████████████████████] 100% | 1/1 | 10.BioC.XML

2026-01-25 10:30:16 [INFO]: Parsing file: 10.BioC.XML
Documents [████████████████] 50% | 1/2 | PMC12349510
  Passages [██████████████] 100% | 45/45
```

## Database Schema

The Prisma schema models the BioC.XML structure:

- **Collection**: Contains source, date, and key metadata
- **Document**: Represents a single article with PMC ID
- **Passage**: Text passages with offset, section type, and content
- **Infon**: Key-value pairs for metadata
- **Annotation**: Entity annotations with type, identifier, location, and text

All relationships use cascading deletes to maintain referential integrity.

## Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run the compiled application
- `npm run dev` - Build and run in one command
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Create and apply database migrations
- `npm run prisma:studio` - Open Prisma Studio to view database
- `npm run prisma:push` - Push schema changes without migration

## Project Structure

```
pubtator-loader/
├── src/
│   ├── index.ts              # Main entry point and CLI
│   ├── xmlParser.ts          # XML parsing logic
│   ├── databaseLoader.ts     # Database operations
│   ├── fileProcessor.ts      # File/directory handling
│   ├── logger.ts             # Winston logger configuration
│   └── types.ts              # TypeScript interfaces
├── prisma/
│   └── schema.prisma         # Database schema
├── data/
│   └── 10.BioC.XML          # Example XML file
├── package.json
├── tsconfig.json
└── .env                      # Database configuration
```

## Example XML Structure

The loader handles BioC.XML files with the following structure:

```xml
<collection>
  <source>PubTator</source>
  <document>
    <id>PMC12349510</id>
    <passage>
      <infon key="type">front</infon>
      <offset>0</offset>
      <text>Article Title</text>
      <annotation id="0">
        <infon key="type">Chemical</infon>
        <infon key="identifier">MESH:C073473</infon>
        <location offset="41" length="28"/>
        <text>Cellulose Acetate Propionate</text>
      </annotation>
    </passage>
  </document>
</collection>
```

## Error Handling

- Individual file errors are logged and processing continues
- Progress bars are properly cleaned up even on errors
- Database transactions ensure data consistency
- Detailed error messages with stack traces in logs

## Development

To view the database during development:

```bash
npm run prisma:studio
```

This opens Prisma Studio in your browser for easy data inspection.

## License

MIT

## Author

Generated for PubTator BioC.XML file processing

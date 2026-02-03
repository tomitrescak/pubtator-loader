#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { XmlParser } from './xmlParser';
import { DatabaseLoader } from './databaseLoader';
import { FileProcessor } from './fileProcessor';
import { logger } from './logger.js';
import { basename } from 'path';
import cliProgress from 'cli-progress';

interface Arguments {
  path: string;
  annotations?: string;
  _: (string | number)[];
  $0: string;
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .usage('Usage: $0 <path> [options]')
    .command('$0 <path>', 'Load BioC.XML file(s) into PostgreSQL database', (yargs) => {
      return yargs.positional('path', {
        describe: 'Path to XML file or directory containing XML files',
        type: 'string',
        demandOption: true,
      });
    })
    .option('annotations', {
      alias: 'a',
      type: 'string',
      description: 'Comma-separated list of required annotation types (e.g., "Gene,Disease"). Only documents with at least one of these annotations will be loaded.',
    })
    .example('$0 data/10.BioC.XML', 'Load a single XML file')
    .example('$0 data/ -a "Gene,Disease"', 'Load documents containing Gene or Disease annotations')
    .example('$0 data/', 'Load all XML files from directory')
    .help('h')
    .alias('h', 'help')
    .version('1.0.0')
    .alias('v', 'version')
    .parse();

  const path = argv.path as string;
  const requiredAnnotations = argv.annotations ? argv.annotations.split(',').map(a => a.trim()) : [];

  logger.info('='.repeat(60));
  logger.info('PubTator BioC.XML Loader');
  logger.info('='.repeat(60));
  if (requiredAnnotations.length > 0) {
    logger.info(`Filtering by annotations: ${requiredAnnotations.join(', ')}`);
  }

  try {
    // Get list of files to process
    const files = FileProcessor.getFilesToProcess(path);
    logger.info(`Found ${files.length} file(s) to process`);

    // Initialize parser and loader
    const parser = new XmlParser();
    const loader = new DatabaseLoader(requiredAnnotations);

    // Connect to database
    await loader.connect();

    // Create MultiBar for both file and document progress
    const multibar = new cliProgress.MultiBar({
      clearOnComplete: false,
      hideCursor: true,
      format: '{label} [{bar}] {percentage}% | {value}/{total} | {name}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
    }, cliProgress.Presets.shades_classic);

    // Create progress bars
    const fileProgressBar = multibar.create(files.length, 0, { label: 'Files    ', name: 'Starting...' });
    const documentProgressBar = multibar.create(1, 0, { label: 'Documents', name: 'Starting...' });

    // Phase 1: Extract all valid documents
    const validDocuments = await loader.extractValidDocuments(files, parser, fileProgressBar);

    if (validDocuments.length === 0) {
      logger.warn('No valid documents found in any files');
      multibar.stop();
      await loader.disconnect();
      return;
    }

    // Phase 2: Process the valid documents
    await loader.processValidDocuments(validDocuments, documentProgressBar);

    multibar.stop();

    // Disconnect from database
    await loader.disconnect();

    logger.info('\n' + '='.repeat(60));
    logger.info(`Processing complete! Processed ${validDocuments.length} document(s) from ${files.length} file(s)`);
    logger.info('='.repeat(60));
  } catch (error) {
    logger.error(`Fatal error: ${(error as Error).message}`);
    if ((error as Error).stack) {
      logger.error((error as Error).stack as string);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error(`Unhandled error: ${error.message}`);
  process.exit(1);
});

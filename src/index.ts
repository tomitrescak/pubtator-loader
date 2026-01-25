#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { XmlParser } from './xmlParser.js';
import { DatabaseLoader } from './databaseLoader.js';
import { FileProcessor } from './fileProcessor.js';
import { logger } from './logger.js';
import { basename } from 'path';
import cliProgress from 'cli-progress';

interface Arguments {
  path: string;
  _: (string | number)[];
  $0: string;
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .usage('Usage: $0 <path>')
    .command('$0 <path>', 'Load BioC.XML file(s) into PostgreSQL database', (yargs) => {
      return yargs.positional('path', {
        describe: 'Path to XML file or directory containing XML files',
        type: 'string',
        demandOption: true,
      });
    })
    .example('$0 data/10.BioC.XML', 'Load a single XML file')
    .example('$0 data/', 'Load all XML files from directory')
    .help('h')
    .alias('h', 'help')
    .version('1.0.0')
    .alias('v', 'version')
    .parse();

  const path = argv.path as string;

  logger.info('='.repeat(60));
  logger.info('PubTator BioC.XML Loader');
  logger.info('='.repeat(60));

  try {
    // Get list of files to process
    const files = FileProcessor.getFilesToProcess(path);
    logger.info(`Found ${files.length} file(s) to process`);

    // Initialize parser and loader
    const parser = new XmlParser();
    const loader = new DatabaseLoader();

    // Connect to database
    await loader.connect();

    // Create MultiBar for nested progress bars
    const multibar = new cliProgress.MultiBar({
      clearOnComplete: false,
      hideCursor: true,
      format: '{label} [{bar}] {percentage}% | {value}/{total} | {name}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
    }, cliProgress.Presets.shades_classic);

    // Create file progress bar
    const fileProgressBar = multibar.create(files.length, 0, { label: 'Files    ', name: 'Starting...' });
        const documentsProgressBar = multibar.create(1, 0, { label: 'Documents', name: 'Starting...' });
// Create document progress bar
        const passagesProgressBar = multibar.create(1, 0, { label: 'Passages', name: 'Starting...' });

    // Process each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileName = basename(file);

      fileProgressBar.update(i + 1, { name: fileName });

      try {
        logger.info(`\nParsing file: ${fileName}`);
        const data = parser.parseFile(file);

        logger.info(`Loading data from: ${fileName}`);
        await loader.loadData(data, fileName, {
            documentsProgressBar,
            passagesProgressBar
        });

        logger.info(`Successfully processed: ${fileName}`);
      } catch (error) {
        logger.error(`Error processing file ${fileName}: ${(error as Error).message}`);
        if ((error as Error).stack) {
          logger.error((error as Error).stack as string);
        }
      }

    }

    multibar.stop();

    // Disconnect from database
    await loader.disconnect();

    logger.info('\n' + '='.repeat(60));
    logger.info(`Processing complete! Processed ${files.length} file(s)`);
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

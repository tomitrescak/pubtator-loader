#!/usr/bin/env node

import fs from 'fs';
import readline from 'readline';
import { prisma } from './prisma.js';
import { logger } from './logger.js';
import cliProgress from 'cli-progress';
import 'dotenv/config';

interface DiseaseRecord {
  meshId: string;
  text: string;
}

export class DiseaseLoader {
  private batchSize = 1000;
  private concurrency = 10;

  async loadDiseaseFile(filePath: string): Promise<void> {
    logger.info('='.repeat(60));
    logger.info('Disease Data Loader');
    logger.info('='.repeat(60));
    logger.info(`Loading disease data from: ${filePath}`);

    try {
      // First count total lines for progress tracking
      logger.info('Counting total lines in file...');
      const totalLines = await this.countLines(filePath);
      logger.info(`Found ${totalLines.toLocaleString()} total lines to process`);

      // Clear existing disease data
      logger.info('Clearing existing disease data...');
      const deletedCount = await prisma.disease.count();
      await prisma.disease.deleteMany();
      logger.info(`Deleted ${deletedCount.toLocaleString()} existing disease records`);

      // Create progress bars
      const multibar = new cliProgress.MultiBar({
        clearOnComplete: false,
        hideCursor: true,
        format: '{label} [{bar}] {percentage}% | {value}/{total} | {rate}/s | ETA: {eta}s | {name}',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
      }, cliProgress.Presets.shades_classic);

      const overallProgressBar = multibar.create(totalLines, 0, { 
        label: 'Overall ', 
        name: 'Processing...', 
      });
      
      const batchProgressBar = multibar.create(100, 0, { 
        label: 'Batches ', 
        name: 'Preparing...', 
      });

      // Process the file
      await this.processFile(filePath, totalLines, overallProgressBar, batchProgressBar);

      multibar.stop();
      
      // Show final statistics
      const finalCount = await prisma.disease.count();
      logger.info('\n' + '='.repeat(60));
      logger.info(`Processing complete!`);
      logger.info(`Total disease records loaded: ${finalCount.toLocaleString()}`);
      logger.info('='.repeat(60));

    } catch (error) {
      logger.error(`Error loading disease data: ${(error as Error).message}`);
      if ((error as Error).stack) {
        logger.error((error as Error).stack as string);
      }
      throw error;
    }
  }

  private async countLines(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      let count = 0;
      const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      
      stream.on('data', (chunk) => {
        count += ((chunk as string).match(/\n/g) || []).length;
      });

      stream.on('end', () => resolve(count));
      stream.on('error', reject);
    });
  }

  private async processFile(
    filePath: string, 
    totalLines: number, 
    overallBar: cliProgress.SingleBar,
    batchBar: cliProgress.SingleBar
  ): Promise<void> {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let batch: DiseaseRecord[] = [];
    let processedLines = 0;
    let validRecords = 0;
    let invalidRecords = 0;
    let batches: DiseaseRecord[][] = [];
    let batchCount = 0;

    const startTime = Date.now();

    for await (const line of rl) {
      processedLines++;

      // Parse the tab-separated line
      const record = this.parseLine(line);
      if (record) {
        batch.push(record);
        validRecords++;
      } else {
        invalidRecords++;
      }

      // When batch is full or we've reached end, add to batches
      if (batch.length >= this.batchSize) {
        batches.push([...batch]);
        batch = [];
        batchCount++;

        // Process batches when we have enough for parallel processing
        if (batches.length >= this.concurrency) {
          await this.processBatches(batches, batchBar);
          batches = [];
        }
      }

      // Update progress every 1000 lines
      if (processedLines % 1000 === 0) {
        overallBar.update(processedLines, { 
          name: `Lines: ${processedLines.toLocaleString()}, Valid: ${validRecords.toLocaleString()}`
        });
      }
    }

    // Process remaining records
    if (batch.length > 0) {
      batches.push(batch);
    }
    if (batches.length > 0) {
      await this.processBatches(batches, batchBar);
    }

    // Final update
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = Math.round(processedLines / elapsed);
    overallBar.update(processedLines, { 
      name: `Completed! Valid: ${validRecords.toLocaleString()}, Invalid: ${invalidRecords.toLocaleString()}`
    });
    batchBar.update(100, { name: 'All batches processed' });

    logger.info(`\nProcessing summary:`);
    logger.info(`- Total lines processed: ${processedLines.toLocaleString()}`);
    logger.info(`- Valid records: ${validRecords.toLocaleString()}`);
    logger.info(`- Invalid records: ${invalidRecords.toLocaleString()}`);
    logger.info(`- Processing rate: ${rate.toLocaleString()} lines/second`);
    logger.info(`- Total time: ${elapsed.toFixed(2)} seconds`);
  }

  private parseLine(line: string): DiseaseRecord | null {
    try {
      const parts = line.trim().split('\t');
      
      // Ensure we have at least 4 columns (ID, Disease, MESH ID, Text)
      if (parts.length < 4) {
        return null;
      }

      const meshId = parts[2]?.trim();
      const text = parts[3]?.trim();

      // Validate required fields
      if (!meshId || !text) {
        return null;
      }

      // Extract actual MESH ID (remove MESH: prefix if present)
      const cleanMeshId = meshId.startsWith('MESH:') ? meshId.substring(5) : meshId;

      return {
        meshId: cleanMeshId,
        text
      };
    } catch (error) {
      return null;
    }
  }

  private async processBatches(batches: DiseaseRecord[][], batchBar: cliProgress.SingleBar): Promise<void> {
    const totalBatches = batches.length;
    let completedBatches = 0;

    // Process batches in parallel
    await Promise.all(
      batches.map(async (batch, batchIndex) => {
        try {
          // Prepare data for Prisma without original ID (auto-increment will handle it)
          const diseaseData = batch.map(record => ({
            meshId: record.meshId,
            text: record.text
          }));

          // Insert the batch using createMany with skipDuplicates to handle composite unique constraint
          await prisma.disease.createMany({
            data: diseaseData,
            skipDuplicates: true // Skip if (meshId, text) combination already exists
          });

          completedBatches++;
          const progress = Math.round((completedBatches / totalBatches) * 100);
          batchBar.update(progress, { 
            name: `Batch ${completedBatches}/${totalBatches} (${batch.length} records)` 
          });

        } catch (error) {
          logger.error(`Error processing batch ${batchIndex}: ${(error as Error).message}`);
          // Continue processing other batches
        }
      })
    );
  }
}

// CLI functionality
async function main() {
  const filePath = process.argv[2] || '/data/disease2pubtator3';
  
  const loader = new DiseaseLoader();
  
  try {
    // Connect to database
    await prisma.$connect();
    logger.info('Connected to database');

    // Load the disease file
    await loader.loadDiseaseFile(filePath);

  } catch (error) {
    logger.error(`Fatal error: ${(error as Error).message}`);
    if ((error as Error).stack) {
      logger.error((error as Error).stack as string);
    }
    process.exit(1);
  } finally {
    // Disconnect from database
    await prisma.$disconnect();
    logger.info('Disconnected from database');
  }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error(`Unhandled error: ${error.message}`);
    process.exit(1);
  });
}
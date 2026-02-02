import { prisma, PrismaClient } from './prisma';
import pg from 'pg';
import { BiocXmlData, DocumentData, PassageData, AnnotationData, InfonData } from './types';
import { logger } from './logger';
import cliProgress, { SingleBar } from 'cli-progress';
import 'dotenv/config';

export class DatabaseLoader {
    private prisma: PrismaClient;

    constructor() {

        this.prisma = prisma;
    }

    async connect(): Promise<void> {
        await this.prisma.$connect();
        logger.info('Connected to database');
    }

    async disconnect(): Promise<void> {
        await this.prisma.$disconnect();
        logger.info('Disconnected from database');
    }

    async loadData(data: BiocXmlData, fileName: string, bars: {
        documentsProgressBar: cliProgress.SingleBar,
        passagesProgressBar: cliProgress.SingleBar
    }): Promise<void> {
        if (!data.collection) {
            logger.warn(`No collection found in file: ${fileName}`);
            return;


        }

        const collection = data.collection;
        const documents = this.ensureArray(collection.document);

        if (documents.length === 0) {
            logger.warn(`No documents found in file: ${fileName}`);
            return;

            // Create document progress bar

        }

        logger.info(`Processing file: ${fileName} with ${documents.length} document(s)`);

        // Create collection

        let dbCollection = await this.prisma.collection.findFirst({
            where: {
                key: fileName || null,
            },
        });

        if (!dbCollection) {
            dbCollection = await this.prisma.collection.create({
                data: {
                    source: collection.source || null,
                    date: collection.date || null,
                    key: fileName || null,
                },
            });

            logger.info(`Created collection: ${dbCollection.id}`);
        } else {

        }



        bars.documentsProgressBar.setTotal(documents.length)
        
        // Split documents into 10 batches for parallel processing
        const CONCURRENCY = 10;
        const batches: DocumentData[][] = [];
        const batchSize = Math.ceil(documents.length / CONCURRENCY);
        
        for (let i = 0; i < documents.length; i += batchSize) {
            batches.push(documents.slice(i, i + batchSize));
        }
        
        logger.info(`Processing ${documents.length} documents in ${batches.length} parallel batches`);
        
        // Process batches in parallel
        let completedCount = 0;
        await Promise.all(
            batches.map(async (batch, batchIndex) => {
                for (const doc of batch) {
                    await this.processDocument(doc, dbCollection.id, bars.passagesProgressBar);
                    completedCount++;
                    bars.documentsProgressBar.update(completedCount, { name: `Document ${doc.id || ''}` });
                }
            })
        );

        logger.info(`Completed processing ${documents.length} document(s) for file: ${fileName}`);
    }

    private async processDocument(doc: DocumentData, collectionId: string, bar: cliProgress.SingleBar): Promise<void> {
        const docId = doc.id!.toString()
        const passages = this.ensureArray(doc.passage);
        bar.setTotal(passages.length);
        // Delete existing document if it exists
        if (await prisma.document.findFirst({
            where: { documentId: docId || '' },
        })) {
            await this.prisma.document.delete({
                where: {
                    documentId: docId || '',
                },
            });
        }

        // Create document
        const dbDocument = await this.prisma.document.create({
            data: {
                documentId: docId,
                collectionId,
            },
        });



        if (passages.length > 0) {
            await this.processPassages(passages, dbDocument.id, bar);
        }
    }

    private async processPassages(passages: PassageData[], documentId: string, bar: cliProgress.SingleBar): Promise<void> {
        // Prepare all passage data with nested infons and annotations
        const passageDataArray = passages.map(passage => {
            const passageInfons = this.ensureArray(passage.infon).map((infon) => ({
                key: infon.attributes.key || '',
                value: infon._text || '',
            }));

            // Extract section_type and type from infons
            let sectionType: string | null = null;
            let type: string | null = null;

            for (const infon of passageInfons) {
                const key = infon.key;
                const value = infon.value || '';

                if (key === 'section_type') {
                    sectionType = value;
                } else if (key === 'type') {
                    type = value;
                }
            }

            // Prepare annotations
            const annotations = this.ensureArray(passage.annotation).map(annotation => {
                const annotationInfons = this.ensureArray(annotation.infon).map((infon) => ({
                    key: infon.attributes.key || '',
                    value: infon._text || '',
                }));

                // Extract identifier and type from infons
                let identifier: string | null = null;
                let annotationType: string | null = null;

                for (const infon of annotationInfons) {
                    const key = infon.key;
                    const value = (infon.value || '').toString();

                    if (key === 'identifier') {
                        identifier = value;
                    } else if (key === 'type') {
                        annotationType = value;
                    }
                }

                // Get location data
                const offset = annotation.location?.[0].attributes.offset || 0;
                const length = annotation.location?.[0].attributes.length || 0;

                return {
                    annotationId: (annotation.attributes.id || '').toString(),
                    identifier: identifier?.toString() || null,
                    type: annotationType,
                    offset,
                    length,
                    text: (annotation.text || '').toString(),
                };
            });

            return {
                documentId,
                offset: passage.offset || 0,
                text: passage.text || '',
                sectionType,
                type,
                infons: passageInfons.length > 0 ? {
                    createMany: {
                        data: passageInfons.map((infon) => ({
                            key: infon.key || '',
                            value: (infon.value || '').toString(),
                        }))
                    }
                } : undefined,
                annotations: annotations.length > 0 ? {
                    createMany: {
                        data: annotations
                    }
                } : undefined,
            };
        });

        // Count total infons and annotations
        const totalInfons = passageDataArray.reduce((sum, p) => sum + (p.infons?.createMany.data.length || 0), 0);
        const totalAnnotations = passageDataArray.reduce((sum, p) => sum + (p.annotations?.createMany.data.length || 0), 0);

        logger.info(`Inserting ${passageDataArray.length} passages with ${totalInfons} infons and ${totalAnnotations} annotations`);

        // Create all passages with nested infons and annotations
        for (const data of passageDataArray) {
            await this.prisma.passage.create({ data });
        }

        // Update progress bar
        bar.update(passages.length, { name: `Passages` });
    }

    private ensureArray<T>(value: T | T[] | undefined): T[] {
        if (value === undefined || value === null) {
            return [];
        }
        return Array.isArray(value) ? value : [value];
    }
}

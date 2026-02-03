import { prisma, PrismaClient } from './prisma';
import pg from 'pg';
import { BiocXmlData, DocumentData, PassageData, AnnotationData, InfonData } from './types';
import { logger } from './logger';
import cliProgress, { SingleBar } from 'cli-progress';
import 'dotenv/config';

interface DocumentInfo {
    document: DocumentData;
    fileName: string;
    documentIndex: number;
    collectionData: {
        source: string | null;
        date: string | null;
        key: string;
    };
}

export class DatabaseLoader {
    private prisma: PrismaClient;
    private requiredAnnotations: string[];

    constructor(requiredAnnotations: string[] = []) {
        this.prisma = prisma;
        this.requiredAnnotations = requiredAnnotations;
    }

    async connect(): Promise<void> {
        await this.prisma.$connect();
        logger.info('Connected to database');
    }

    async disconnect(): Promise<void> {
        await this.prisma.$disconnect();
        logger.info('Disconnected from database');
    }

    async extractValidDocuments(files: string[], parser: any, fileProgressBar: cliProgress.SingleBar): Promise<DocumentInfo[]> {
        logger.info('Phase 1: Extracting all valid documents...');
        const allValidDocuments: DocumentInfo[] = [];
        
        fileProgressBar.setTotal(files.length);
        fileProgressBar.start(files.length, 0);
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const fileName = file.split('/').pop() || file;

            logger.info(`Processing file: ${i+1}/${files.length} - ${fileName}`);

            
            try {
                // Temporarily reduce logging during extraction to keep progress bar visible
                const data = parser.parseFile(file);
                
                if (!data.collection) {
                    logger.warn(`No collection found in file: ${fileName}`);
                    continue;
                }
                
                const collection = data.collection;
                const documents = this.ensureArray(collection.document);
                
                if (documents.length === 0) {
                    logger.warn(`No documents found in file: ${fileName}`);
                    continue;
                }
                
                // Prepare collection data for later creation
                const collectionData = {
                    source: collection.source || null,
                    date: collection.date || null,
                    key: fileName,
                };
                
                // Filter valid documents
                const validDocuments = documents
                    .map((doc, index) => ({ doc, index }))
                    .filter(({ doc }) => this.shouldProcessDocument(doc))
                    .map(({ doc, index }) => ({
                        document: doc,
                        fileName,
                        documentIndex: index,
                        collectionData
                    }));
                
                allValidDocuments.push(...validDocuments);
                
                // Only log summary instead of individual file processing
                if (validDocuments.length > 0) {
                    logger.info(`${fileName}: ${validDocuments.length}/${documents.length} valid documents`);
                }
            } catch (error) {
                logger.error(`Error in ${fileName}: ${(error as Error).message}`);
            }
        }
        
        fileProgressBar.update(files.length, { name: 'Extraction complete' });
        fileProgressBar.stop();
        
        logger.info(`Phase 1 complete: Found ${allValidDocuments.length} total valid documents`);
        return allValidDocuments;
    }

    async processValidDocuments(validDocuments: DocumentInfo[], progressBar: cliProgress.SingleBar): Promise<void> {
        logger.info('Phase 2: Processing valid documents...');
        
        if (validDocuments.length === 0) {
            logger.warn('No valid documents to process');
            return;
        }
        
        progressBar.setTotal(validDocuments.length);
        
        // Process documents in batches for better performance
        const CONCURRENCY = 10;
        const batches: DocumentInfo[][] = [];
        const batchSize = Math.ceil(validDocuments.length / CONCURRENCY);
        
        for (let i = 0; i < validDocuments.length; i += batchSize) {
            batches.push(validDocuments.slice(i, i + batchSize));
        }
        
        logger.info(`Processing ${validDocuments.length} documents in ${batches.length} parallel batches`);
        
        let completedCount = 0;
        await Promise.all(
            batches.map(async (batch) => {
                for (const docInfo of batch) {
                    await this.processDocumentOnly(docInfo.document, docInfo.collectionData);
                    completedCount++;
                    progressBar.update(completedCount, { 
                        name: `${docInfo.fileName}:${docInfo.documentIndex} (ID: ${docInfo.document.id})` 
                    });
                    logger.info(`Processed document ${completedCount}/${validDocuments.length} - ${docInfo.fileName}:${docInfo.documentIndex}`);
                }
            })
        );
        
        logger.info(`Phase 2 complete: Processed ${validDocuments.length} documents`);
    }

    private async processDocumentOnly(doc: DocumentData, collectionData: { source: string | null; date: string | null; key: string }): Promise<void> {
        const docId = doc.id!.toString();
        
        // Create or get collection
        let dbCollection = await this.prisma.collection.findFirst({
            where: { key: collectionData.key }
        });
        
        if (!dbCollection) {
            dbCollection = await this.prisma.collection.create({
                data: collectionData,
            });
            logger.info(`Created collection: ${dbCollection.id}`);
        }
        
        // Delete existing document if it exists
        const existingDoc = await this.prisma.document.findFirst({
            where: { documentId: docId }
        });
        
        if (existingDoc) {
            await this.prisma.document.delete({
                where: { documentId: docId }
            });
        }
        
        // Create document
        const dbDocument = await this.prisma.document.create({
            data: {
                documentId: docId,
                collectionId: dbCollection.id,
            },
        });
        
        // Process passages without progress tracking
        const passages = this.ensureArray(doc.passage);
        if (passages.length > 0) {
            await this.processPassagesWithoutProgress(passages, dbDocument.id);
        }
    }

    private async processPassagesWithoutProgress(passages: PassageData[], documentId: string): Promise<void> {
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

        // Create all passages with nested infons and annotations
        for (const data of passageDataArray) {
            await this.prisma.passage.create({ data });
        }
    }

    private shouldProcessDocument(doc: DocumentData): boolean {
        // If no required annotations specified, process all documents
        if (this.requiredAnnotations.length === 0) {
            return true;
        }

        // Check all passages in the document for required annotations
        const passages = this.ensureArray(doc.passage);
        for (const passage of passages) {
            const annotations = this.ensureArray(passage.annotation);
            for (const annotation of annotations) {
                const annotationInfons = this.ensureArray(annotation.infon);
                for (const infon of annotationInfons) {
                     if (infon.attributes.key === 'type' || infon.attributes.key === 'identifier') {
                        const annotationType = infon._text || '';
                        if (this.requiredAnnotations.includes(annotationType)) {
                            return true;
                        }
                    }
                }
            }
        }
        
        return false;
    }

    private ensureArray<T>(value: T | T[] | undefined): T[] {
        if (value === undefined || value === null) {
            return [];
        }
        return Array.isArray(value) ? value : [value];
    }
}

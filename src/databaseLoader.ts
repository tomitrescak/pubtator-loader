import { prisma, PrismaClient } from './prisma';
import pg from 'pg';
import { BiocXmlData, DocumentData, PassageData, AnnotationData, InfonData } from './types';
import { logger } from './logger';
import ProgressBar from 'progress';
import * as fs from 'fs';
import 'dotenv/config';
import { log } from 'console';

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

    private async hasRequiredAnnotationsInText(filePath: string): Promise<boolean> {
        // If no required annotations specified, process all files
        if (this.requiredAnnotations.length === 0) {
            return true;
        }

        try {
            const fileContent = await fs.promises.readFile(filePath, 'utf-8');
            
            // Look for annotation infon elements with required types
            for (const requiredType of this.requiredAnnotations) {
                // Check for type infons: <infon key="type">requiredType</infon>
                const typePattern = new RegExp(`<infon\\s+key=["']type["'][^>]*>\\s*${requiredType}\\s*</infon>`, 'i');
                // Check for identifier infons: <infon key="identifier">requiredType</infon>
                const idPattern = new RegExp(`<infon\\s+key=["']identifier["'][^>]*>\\s*${requiredType}\\s*</infon>`, 'i');
                
                if (typePattern.test(fileContent) || idPattern.test(fileContent)) {
                    return true;
                }
            }
            
            return false;
        } catch (error) {
            logger.error(`Error reading file for text validation ${filePath}: ${(error as Error).message}`);
            // If we can't read the file for text validation, assume it might have annotations
            return true;
        }
    }

    async extractValidDocuments(files: string[], parser: any): Promise<void> {
        logger.info('Processing files and inserting valid documents to database...');
        
        const fileProgressBar = new ProgressBar('Processing [:bar] :current/:total :percent :file', {
            complete: '█',
            incomplete: '░',
            width: 40,
            total: files.length
        });

        let totalDocumentsProcessed = 0;
        let totalDocumentsInserted = 0;
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const fileName = file.split('/').pop() || file;

            fileProgressBar.tick({ file: fileName });

            try {
                const hasRequiredAnnotations = await this.hasRequiredAnnotationsInText(file);
                
                if (!hasRequiredAnnotations) {
                    logger.info(`${fileName}: Skipped (no required annotations)`);
                    continue;
                }
                
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
                
                const collectionData = {
                    source: collection.source || null,
                    date: collection.date || null,
                    key: fileName,
                };
                
                const validDocuments = documents.filter(doc => this.shouldProcessDocument(doc));
                logger.info(`${fileName}: ${validDocuments.length}/${documents.length} valid documents found`);
                
                let documentsInserted = 0;
                
                for (const doc of validDocuments) {
                    const wasInserted = await this.insertDocumentIfNotExists(doc, collectionData);
                    if (wasInserted) documentsInserted++;
                }
                
                totalDocumentsProcessed += validDocuments.length;
                totalDocumentsInserted += documentsInserted;
                
                logger.info(`${fileName}: ${documentsInserted}/${validDocuments.length} docs inserted (${validDocuments.length}/${documents.length} valid)`);
                
            } catch (error) {
                logger.error(`Error processing ${fileName}: ${(error as Error).message}`);
            }
        }
        
        logger.info(`Processing complete: Inserted ${totalDocumentsInserted}/${totalDocumentsProcessed} documents`);
    }

    private async insertDocumentIfNotExists(doc: DocumentData, collectionData: { source: string | null; date: string | null; key: string }): Promise<boolean> {
        const docId = doc.id!.toString();
        
        // Check if document already exists
        const existingDoc = await this.prisma.document.findFirst({
            where: { documentId: docId }
        });
        
        if (existingDoc) {
            // Document exists, skip it
            return false;
        }
        
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
        
        // Create document
        const dbDocument = await this.prisma.document.create({
            data: {
                documentId: docId,
                collectionId: dbCollection.id,
            },
        });
        
        // Process passages
        const passages = this.ensureArray(doc.passage);
        if (passages.length > 0) {
            await this.processPassagesWithoutProgress(passages, dbDocument.id);
        }
        
        return true; // Document was inserted
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

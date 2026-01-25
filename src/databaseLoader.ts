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
        for (let i = 0; i < documents.length; i++) {
            const doc = documents[i];
            await this.processDocument(doc, dbCollection.id, bars.passagesProgressBar);
            bars.documentsProgressBar.update(i + 1, { name: `Document ${doc.id || ''}` });
        }

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
            for (let i = 0; i < passages.length; i++) {
                const passage = passages[i];
                await this.processPassage(passage, dbDocument.id);
                bar.update(i + 1, { name: `Passage` });
            }
        }
    }

    private async processPassage(passage: PassageData, documentId: string): Promise<void> {
        const passageInfons = this.ensureArray(passage.infon).map((infon) => ({
            key: infon['@_key'] || '',
            value: infon['#text'] || '',
        }));
        const annotations = this.ensureArray(passage.annotation);

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

        const dbPassage = await this.prisma.passage.create({
            data: {
                documentId,
                offset: passage.offset || 0,
                text: passage.text || '',
                sectionType,
                type,
            },
        });

        // Create infons
        if (passageInfons.length > 0) {
            const pinfons = passageInfons.map((infon) => ({
                passageId: dbPassage.id,
                key: infon.key || '',
                value: (infon.value || '').toString(),
            }))
            await this.prisma.passageInfon.createMany({
                data: pinfons,
            });
        }

        // Create annotations
        for (const annotation of annotations) {
            await this.processAnnotation(annotation, dbPassage.id);
        }
    }

    private async processAnnotation(annotation: AnnotationData, passageId: string): Promise<void> {


        // Extract identifier and type from infons
        let identifier: string | null = null;
        let type: string | null = null;



        // Get location data
        const offset = annotation.location?.[0]['@_offset'] || 0;
        const length = annotation.location?.[0]['@_length'] || 0;





        const annotationInfons = this.ensureArray(annotation.infon).map((infon) => ({
            key: infon['@_key'] || '',
            value: infon['#text'] || '',
        }));

        for (const infon of annotationInfons) {
            const key = infon.key;
            const value = (infon.value || '').toString();

            if (key === 'identifier') {
                identifier = value;
            } else if (key === 'type') {
                type = value;
            }
        }

        await this.prisma.annotation.create({
            data: {
                passageId,
                annotationId: (annotation["@_id"] || '').toString(),
                identifier: identifier?.toString(),
                type,
                offset,
                length,
                text: ( annotation.text || '').toString(),
            },
        });
    }

    private ensureArray<T>(value: T | T[] | undefined): T[] {
        if (value === undefined || value === null) {
            return [];
        }
        return Array.isArray(value) ? value : [value];
    }
}

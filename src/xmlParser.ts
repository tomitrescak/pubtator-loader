import { XMLParser } from 'fast-xml-parser';
import { readFileSync } from 'fs';
import { BiocXmlData } from './types.js';

export class XmlParser {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: true,
      parseTagValue: true,
      trimValues: true,
      isArray: (tagName) => {
        // These tags should always be treated as arrays
        return ['document', 'passage', 'annotation', 'infon', 'location'].includes(tagName);
      },
    });
  }

  parseFile(filePath: string): BiocXmlData {
    const xmlContent = readFileSync(filePath, 'utf-8');
    const result = this.parser.parse(xmlContent);
    return result as BiocXmlData;
  }
}
